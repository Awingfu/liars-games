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
