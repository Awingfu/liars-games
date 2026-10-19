import { describe, expect, it } from 'vitest'
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
