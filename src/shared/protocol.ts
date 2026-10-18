import { z } from 'zod'
import type { PlayerId } from './engine'
import type { DiceConfig, DiceView } from './games/liarsDice'

export const MAX_PLAYERS = 8

const Name = z.string().trim().min(1).max(20)

export const DiceConfigSchema = z.object({
  startingDice: z.number().int().min(1).max(10),
  onesWild: z.boolean(),
  spotOn: z.boolean(),
})

export const RoomSettingsSchema = z.object({
  game: DiceConfigSchema,
  /** 0 = no turn timer. */
  turnSeconds: z.number().int().min(0).max(300),
})
export type RoomSettings = z.infer<typeof RoomSettingsSchema>

export const DiceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), qty: z.number().int(), face: z.number().int() }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('spotOn') }),
])

/** Every client → server message, sent on the `c2s` event with an ack callback. */
export const ClientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('room:create'), name: Name }),
  z.object({ t: z.literal('room:join'), code: z.string().trim().toUpperCase().length(5), name: Name }),
  z.object({ t: z.literal('room:leave') }),
  z.object({ t: z.literal('room:settings'), settings: RoomSettingsSchema }),
  z.object({ t: z.literal('room:ready'), ready: z.boolean() }),
  z.object({ t: z.literal('game:start') }),
  z.object({ t: z.literal('game:action'), action: DiceActionSchema }),
  z.object({ t: z.literal('game:backToLobby') }),
])
export type ClientMsg = z.infer<typeof ClientMsg>

export type Ack = { ok: true } | { ok: false; error: string }

export interface RoomPlayerView {
  id: PlayerId
  name: string
  connected: boolean
  ready: boolean
  left: boolean
}

export interface RoomView {
  code: string
  hostId: PlayerId
  status: 'lobby' | 'playing'
  players: RoomPlayerView[]
  settings: RoomSettings
  /** Epoch ms when the current turn auto-plays, if a timer is running. */
  turnDeadline: number | null
}

/** Server → client `state` event: everything this player is allowed to see. */
export interface StateMsg {
  you: PlayerId
  room: RoomView | null
  game: DiceView | null
}

/** Server → client `session` event, sent on connect. */
export interface SessionMsg {
  token: string
  playerId: PlayerId
}

export const DEFAULT_SETTINGS: RoomSettings = {
  game: { startingDice: 5, onesWild: false, spotOn: true } satisfies DiceConfig,
  turnSeconds: 45,
}
