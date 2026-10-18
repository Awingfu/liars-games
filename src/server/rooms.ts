import { randomInt } from 'node:crypto'
import type { GameEngine, PlayerId, Rng } from '../shared/engine'
import { liarsDice } from '../shared/games/liarsDice'
import { liarsPoker } from '../shared/games/liarsPoker'
import {
  ACTION_SCHEMAS,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  type GameType,
  type RoomSettings,
  type RoomView,
  type StateMsg,
} from '../shared/protocol'

/** Rooms hold opaque engine state; each engine only ever sees its own. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = GameEngine<any, any, any, NonNullable<StateMsg['game']>>
const ENGINES: Record<GameType, AnyEngine> = { dice: liarsDice, poker: liarsPoker }

const REVEAL_MS = 5000
/** Turn limit used for a disconnected player when the room has no timer. */
const DISCONNECTED_TURN_MS = 60_000
const ABANDONED_ROOM_MS = 10 * 60_000

export const cryptoRng: Rng = { int: (max) => randomInt(max) }

interface RoomPlayer {
  id: PlayerId
  name: string
  connected: boolean
  ready: boolean
  left: boolean
}

interface Room {
  code: string
  hostId: PlayerId
  status: 'lobby' | 'playing'
  players: RoomPlayer[]
  settings: RoomSettings
  /** Game type of `state`, fixed when the game starts. */
  playing: GameType | null
  state: unknown
  turnDeadline: number | null
  timer: NodeJS.Timeout | null
  emptySince: number | null
}

export class RoomError extends Error {}
function fail(msg: string): never {
  throw new RoomError(msg)
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/L/O/0/1

export class RoomManager {
  private rooms = new Map<string, Room>()
  private roomOf = new Map<PlayerId, string>()

  constructor(
    /** Called with each player's personalized state whenever a room changes. */
    private send: (playerId: PlayerId, msg: StateMsg) => void,
    private rng: Rng = cryptoRng,
  ) {}

  // ---- queries ----

  roomCodeOf(playerId: PlayerId) {
    return this.roomOf.get(playerId)
  }

  stateFor(playerId: PlayerId): StateMsg {
    const room = this.findRoom(playerId)
    if (!room) return { you: playerId, room: null, game: null }
    const view: RoomView = {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      players: room.players.map(({ id, name, connected, ready, left }) => ({ id, name, connected, ready, left })),
      settings: room.settings,
      turnDeadline: room.turnDeadline,
    }
    return { you: playerId, room: view, game: room.state ? this.engine(room).viewFor(room.state, playerId) : null }
  }

  // ---- lobby ----

  create(playerId: PlayerId, name: string) {
    this.leave(playerId)
    let code: string
    do code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    while (this.rooms.has(code))
    const room: Room = {
      code,
      hostId: playerId,
      status: 'lobby',
      players: [{ id: playerId, name, connected: true, ready: false, left: false }],
      settings: structuredClone(DEFAULT_SETTINGS),
      playing: null,
      state: null,
      turnDeadline: null,
      timer: null,
      emptySince: null,
    }
    this.rooms.set(code, room)
    this.roomOf.set(playerId, code)
    this.broadcast(room)
  }

  join(playerId: PlayerId, code: string, name: string) {
    const room = this.rooms.get(code) ?? fail('Room not found')
    const existing = room.players.find((p) => p.id === playerId && !p.left)
    if (existing) {
      existing.connected = true
      if (room.status === 'lobby') existing.name = name
    } else {
      if (room.status !== 'lobby') fail('Game already in progress')
      if (room.players.length >= MAX_PLAYERS) fail('Room is full')
      this.leave(playerId)
      room.players.push({ id: playerId, name, connected: true, ready: false, left: false })
      this.roomOf.set(playerId, code)
    }
    room.emptySince = null
    this.broadcast(room)
  }

  leave(playerId: PlayerId) {
    const room = this.findRoom(playerId)
    if (!room) return
    this.roomOf.delete(playerId)
    if (room.status === 'lobby') {
      room.players = room.players.filter((p) => p.id !== playerId)
    } else {
      const p = room.players.find((p) => p.id === playerId)!
      p.left = true
      p.connected = false
      room.state = this.engine(room).forfeit(room.state, playerId)
      this.schedule(room)
    }
    if (room.hostId === playerId) {
      const next = room.players.find((p) => !p.left)
      if (next) room.hostId = next.id
    }
    this.send(playerId, { you: playerId, room: null, game: null })
    if (!room.players.some((p) => !p.left)) return this.destroy(room)
    this.broadcast(room)
  }

  updateSettings(playerId: PlayerId, settings: RoomSettings) {
    const room = this.hostRoom(playerId)
    if (room.status !== 'lobby') fail('Settings are locked during a game')
    room.settings = settings
    for (const p of room.players) p.ready = false
    this.broadcast(room)
  }

  setReady(playerId: PlayerId, ready: boolean) {
    const room = this.findRoom(playerId) ?? fail('Not in a room')
    if (room.status !== 'lobby') fail('Game already started')
    room.players.find((p) => p.id === playerId)!.ready = ready
    this.broadcast(room)
  }

  start(playerId: PlayerId) {
    const room = this.hostRoom(playerId)
    if (room.status !== 'lobby') fail('Game already started')
    if (room.players.length < 2) fail('Need at least 2 players')
    if (room.players.some((p) => p.id !== room.hostId && !p.ready)) fail('Everyone must be ready')
    const game = room.settings.game
    const engine = ENGINES[game]
    const config = room.settings[game]
    const problem = engine.canStart?.(room.players.length, config)
    if (problem) fail(problem)
    room.status = 'playing'
    room.playing = game
    room.state = engine.init(
      room.players.map((p) => p.id),
      config,
      this.rng,
    )
    this.schedule(room)
    this.broadcast(room)
  }

  backToLobby(playerId: PlayerId) {
    const room = this.hostRoom(playerId)
    if (room.status !== 'playing' || !room.state || this.engine(room).phase(room.state) !== 'over') fail('Game is not over')
    this.clearTimer(room)
    room.status = 'lobby'
    room.playing = null
    room.state = null
    room.players = room.players.filter((p) => !p.left)
    for (const p of room.players) p.ready = false
    this.broadcast(room)
  }

  // ---- gameplay ----

  act(playerId: PlayerId, rawAction: unknown) {
    const room = this.findRoom(playerId) ?? fail('Not in a room')
    if (!room.state || !room.playing) fail('No game running')
    const action = ACTION_SCHEMAS[room.playing].safeParse(rawAction)
    if (!action.success) fail('Invalid move')
    const result = this.engine(room).apply(room.state, playerId, action.data, this.rng)
    if (!result.ok) fail(result.error)
    room.state = result.value
    this.schedule(room)
    this.broadcast(room)
  }

  // ---- connections ----

  setConnected(playerId: PlayerId, connected: boolean) {
    const room = this.findRoom(playerId)
    if (!room) return
    const p = room.players.find((p) => p.id === playerId)
    if (!p || p.left) return
    p.connected = connected
    if (room.players.every((p) => !p.connected)) room.emptySince ??= Date.now()
    else room.emptySince = null
    // Without a room timer, a disconnected player's turn still needs a limit.
    if (room.state && room.settings.turnSeconds === 0 && this.engine(room).currentPlayer(room.state) === playerId)
      this.schedule(room)
    this.broadcast(room)
  }

  /** Remove rooms nobody has been connected to for a while. */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values())
      if (room.emptySince && now - room.emptySince > ABANDONED_ROOM_MS) this.destroy(room)
  }

  // ---- internals ----

  /** Arm the right timer for the room's current phase. */
  private schedule(room: Room) {
    this.clearTimer(room)
    const s = room.state
    if (!s) return
    const engine = this.engine(room)
    const phase = engine.phase(s)
    if (phase === 'reveal') {
      room.timer = setTimeout(() => {
        room.state = engine.nextRound(room.state!, this.rng)
        this.schedule(room)
        this.broadcast(room)
      }, REVEAL_MS)
    } else if (phase === 'playing') {
      const current = engine.currentPlayer(s)!
      const connected = room.players.find((p) => p.id === current)?.connected
      const ms = room.settings.turnSeconds > 0 ? room.settings.turnSeconds * 1000 : connected ? 0 : DISCONNECTED_TURN_MS
      if (!ms) return
      room.turnDeadline = Date.now() + ms
      room.timer = setTimeout(() => {
        const r = engine.apply(room.state!, current, engine.timeoutAction(room.state!), this.rng)
        if (r.ok) room.state = r.value
        this.schedule(room)
        this.broadcast(room)
      }, ms)
    }
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer)
    room.timer = null
    room.turnDeadline = null
  }

  private destroy(room: Room) {
    this.clearTimer(room)
    this.rooms.delete(room.code)
    for (const p of room.players) if (this.roomOf.get(p.id) === room.code) this.roomOf.delete(p.id)
  }

  private engine(room: Room): AnyEngine {
    return ENGINES[room.playing ?? room.settings.game]
  }

  private findRoom(playerId: PlayerId) {
    const code = this.roomOf.get(playerId)
    return code ? this.rooms.get(code) : undefined
  }

  private hostRoom(playerId: PlayerId) {
    const room = this.findRoom(playerId) ?? fail('Not in a room')
    if (room.hostId !== playerId) fail('Only the host can do that')
    return room
  }

  private broadcast(room: Room) {
    for (const p of room.players) if (!p.left) this.send(p.id, this.stateFor(p.id))
  }
}
