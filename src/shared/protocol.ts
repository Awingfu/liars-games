import { z } from 'zod'
import type { PlayerId } from './engine'
import type { DiceView } from './games/liarsDice'
import type { PokerView } from './games/liarsPoker'

export const MAX_PLAYERS = 8

const Name = z.string().trim().min(1).max(20)

export const DiceConfigSchema = z.object({
  startingDice: z.number().int().min(1).max(10),
  onesWild: z.boolean(),
  spotOn: z.boolean(),
})

export const PokerConfigSchema = z.object({
  startingCards: z.number().int().min(1).max(6),
  maxCards: z.number().int().min(1).max(6),
})

export const GAME_TYPES = ['dice', 'poker'] as const
export type GameType = (typeof GAME_TYPES)[number]
export const GAME_NAMES: Record<GameType, string> = { dice: "Liar's Dice", poker: "Liar's Poker" }

export const RoomSettingsSchema = z.object({
  game: z.enum(GAME_TYPES),
  dice: DiceConfigSchema,
  poker: PokerConfigSchema,
  /** 0 = no turn timer. */
  turnSeconds: z.number().int().min(0).max(300),
})
export type RoomSettings = z.infer<typeof RoomSettingsSchema>

export const DiceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), qty: z.number().int(), face: z.number().int() }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('spotOn') }),
])

const RankSchema = z.number().int()
const SuitSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
/** Shape only; ranges and ordering are checked by the poker engine. */
export const ClaimSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('high'), rank: RankSchema }),
  z.object({ type: z.literal('pair'), rank: RankSchema }),
  z.object({ type: z.literal('twoPair'), high: RankSchema, low: RankSchema }),
  z.object({ type: z.literal('trips'), rank: RankSchema }),
  z.object({ type: z.literal('straight'), high: RankSchema }),
  z.object({ type: z.literal('flush'), suit: SuitSchema, high: RankSchema }),
  z.object({ type: z.literal('fullHouse'), trips: RankSchema, pair: RankSchema }),
  z.object({ type: z.literal('quads'), rank: RankSchema }),
  z.object({ type: z.literal('straightFlush'), suit: SuitSchema, high: RankSchema }),
])

export const PokerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), claim: ClaimSchema }),
  z.object({ type: z.literal('call') }),
])

/** `game:action` payloads are validated against the schema of the game being played. */
export const ACTION_SCHEMAS = { dice: DiceActionSchema, poker: PokerActionSchema } satisfies Record<GameType, z.ZodTypeAny>
export type GameAction = z.infer<typeof DiceActionSchema> | z.infer<typeof PokerActionSchema>

/** Every client → server message, sent on the `c2s` event with an ack callback. */
export const ClientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('room:create'), name: Name }),
  z.object({ t: z.literal('room:join'), code: z.string().trim().toUpperCase().length(5), name: Name }),
  z.object({ t: z.literal('room:leave') }),
  z.object({ t: z.literal('room:settings'), settings: RoomSettingsSchema }),
  z.object({ t: z.literal('room:ready'), ready: z.boolean() }),
  z.object({ t: z.literal('game:start') }),
  z.object({ t: z.literal('game:action'), action: z.custom<GameAction>((v) => typeof v === 'object' && v !== null) }),
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
  game: DiceView | PokerView | null
}

/** Server → client `session` event, sent on connect. */
export interface SessionMsg {
  token: string
  playerId: PlayerId
}

export const DEFAULT_SETTINGS: RoomSettings = {
  game: 'dice',
  dice: { startingDice: 5, onesWild: false, spotOn: true },
  poker: { startingCards: 1, maxCards: 5 },
  turnSeconds: 45,
}
