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
    expect(bot).toMatchObject({ bot: true, ready: true })
    rooms.removeBot('host', bot.id)
    expect(names()).toEqual(['Alice', 'Bot 2'])
    rooms.addBot('host')
    expect(names()).toEqual(['Alice', 'Bot 2', 'Bot 1'])
  })

  it('only the host can add bots, and only real bots can be removed', () => {
    const { rooms, code } = setup()
    rooms.join('p2', code, 'Bob')
    expect(() => rooms.addBot('p2')).toThrow(/host/)
    expect(() => rooms.removeBot('host', 'p2')).toThrow(/No such bot/)
  })

  it('plays a full game against bots', () => {
    vi.useFakeTimers()
    try {
      const { rooms } = setup()
      rooms.updateSettings('host', { ...rooms.stateFor('host').room!.settings, turnSeconds: 0 })
      rooms.addBot('host')
      rooms.addBot('host')
      rooms.start('host')
      for (let i = 0; i < 2000 && rooms.stateFor('host').game!.phase !== 'over'; i++) {
        const g = rooms.stateFor('host').game!
        if (g.phase === 'bidding' && g.turnPlayerId === 'host')
          rooms.act('host', g.bid ? { type: 'call' } : { type: 'bid', qty: 1, face: 2 })
        else vi.advanceTimersByTime(5000)
      }
      expect(rooms.stateFor('host').game!.phase).toBe('over')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to start a game bots cannot play, and closes the room when the last human leaves', () => {
    const { rooms, code } = setup()
    rooms.addBot('host')
    rooms.updateSettings('host', { ...rooms.stateFor('host').room!.settings, game: 'poker' })
    expect(() => rooms.start('host')).toThrow(/Bots can't play/)
    rooms.leave('host')
    expect(() => rooms.join('p2', code, 'Bob')).toThrow(/not found/)
  })
})
