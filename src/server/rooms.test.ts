import { describe, expect, it, vi } from 'vitest'
import { seededRng } from '../shared/engine'
import type { DiceView } from '../shared/games/liarsDice'
import type { PokerView } from '../shared/games/liarsPoker'
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
    expect(rooms.join('cara2', code, 'Cara')).toBe('cara2') // a new spectator, not the forfeited seat
    expect(rooms.stateFor('cara2').room!.players.find((p) => p.id === 'cara2')!.spectator).toBe(true)
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
        const g = rooms.stateFor('host').game! as DiceView | PokerView
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

describe('RoomManager spectators', () => {
  function midGame() {
    const { rooms, code, names } = setup()
    rooms.join('bob', code, 'Bob')
    rooms.setReady('bob', true)
    rooms.start('host')
    return { rooms, code, names }
  }
  const member = (rooms: RoomManager, id: string) => rooms.stateFor('host').room!.players.find((p) => p.id === id)

  it('joining mid-game makes you a spectator who sees no hidden info', () => {
    const { rooms, code } = midGame()
    rooms.join('sam', code, 'Sam')
    expect(member(rooms, 'sam')).toMatchObject({ spectator: true })
    const g = rooms.stateFor('sam').game as DiceView
    expect(g.players.map((p) => p.id)).toEqual(expect.not.arrayContaining(['sam']))
    expect(g.players.every((p) => p.dice === null)).toBe(true)
    expect(() => rooms.act('sam', { type: 'call' })).toThrow()
  })

  it('a spectator leaving mid-game is simply removed, and spectators get seats next game', () => {
    const { rooms, code, names } = midGame()
    rooms.join('sam', code, 'Sam')
    rooms.join('kim', code, 'Kim')
    rooms.leave('kim')
    expect(names()).toEqual(['Alice', 'Bob', 'Sam'])
    rooms.leave('bob') // forfeit ends the 2-player game
    rooms.backToLobby('host')
    expect(member(rooms, 'sam')).toMatchObject({ spectator: false, ready: false })
  })

  it('a full lobby seats newcomers as spectators; they can take a freed seat', () => {
    const { rooms, code } = setup()
    for (let i = 0; i < 7; i++) rooms.addBot('host')
    rooms.join('sam', code, 'Sam')
    expect(member(rooms, 'sam')!.spectator).toBe(true)
    expect(() => rooms.setSpectator('sam', false)).toThrow(/No free seats/)
    rooms.removeBot('host', rooms.stateFor('host').room!.players.find((p) => p.bot)!.id)
    rooms.setSpectator('sam', false)
    expect(member(rooms, 'sam')!.spectator).toBe(false)
  })

  it('spectators are left out of the game and the ready check', () => {
    const { rooms, code } = setup()
    rooms.join('bob', code, 'Bob')
    rooms.join('sam', code, 'Sam')
    rooms.setSpectator('sam', true) // not ready, but watching
    rooms.setReady('bob', true)
    rooms.start('host')
    expect(rooms.stateFor('host').game!.players.map((p) => p.id).sort()).toEqual(['bob', 'host'])
  })
})

describe('RoomManager scoreboard', () => {
  it('counts wins and games per player across games', () => {
    const { rooms, code } = setup()
    rooms.join('bob', code, 'Bob')
    rooms.join('cara', code, 'Cara')
    const play = (quitter: string, winnerLeft: string) => {
      for (const id of ['bob', 'cara']) rooms.setReady(id, true)
      rooms.start('host')
      // Two forfeits end it; forfeiters rejoin the lobby afterwards.
      rooms.leave(quitter)
      rooms.leave(winnerLeft)
      rooms.backToLobby('host')
      rooms.join(quitter, code, quitter === 'bob' ? 'Bob' : 'Cara')
      rooms.join(winnerLeft, code, winnerLeft === 'bob' ? 'Bob' : 'Cara')
    }
    play('bob', 'cara')
    play('cara', 'bob')
    const scores = rooms.stateFor('host').room!.scores
    expect(scores[0]).toMatchObject({ name: 'Alice', wins: 2, games: 2 })
    expect(scores.find((s) => s.name === 'Bob')).toMatchObject({ wins: 0, games: 2 })
  })

  it('records a finished game once and includes bots', () => {
    vi.useFakeTimers()
    try {
      const { rooms } = setup()
      rooms.updateSettings('host', { ...rooms.stateFor('host').room!.settings, turnSeconds: 0 })
      rooms.addBot('host')
      rooms.start('host')
      for (let i = 0; i < 2000 && rooms.stateFor('host').game!.phase !== 'over'; i++) {
        const g = rooms.stateFor('host').game! as DiceView
        if (g.phase === 'bidding' && g.turnPlayerId === 'host')
          rooms.act('host', g.bid ? { type: 'call' } : { type: 'bid', qty: 1, face: 2 })
        else vi.advanceTimersByTime(5000)
      }
      vi.advanceTimersByTime(60_000)
      const scores = rooms.stateFor('host').room!.scores
      expect(scores.map((s) => s.name).sort()).toEqual(['Alice', 'Bot 1'])
      expect(scores.every((s) => s.games === 1)).toBe(true)
      expect(scores.reduce((n, s) => n + s.wins, 0)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
