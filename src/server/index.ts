import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import path from 'node:path'
import express from 'express'
import { Server } from 'socket.io'
import { ClientMsg, type Ack, type SessionMsg, type StateMsg } from '../shared/protocol'
import { RoomError, RoomManager } from './rooms'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.get('/healthz', (_req, res) => res.send('ok'))
if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(import.meta.dirname, '../../dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}
const http = createServer(app)
const io = new Server(http, { maxHttpBufferSize: 10_000 })

const playerRoom = (playerId: string) => `p:${playerId}`
const rooms = new RoomManager((playerId, msg: StateMsg) => io.to(playerRoom(playerId)).emit('state', msg))
setInterval(() => rooms.sweep(), 60_000).unref()

/** Session token (secret, kept in localStorage) → public player id. */
const sessions = new Map<string, string>()
/** Open socket count per player, so multiple tabs don't flap "connected". */
const socketCount = new Map<string, number>()

io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  let playerId = typeof token === 'string' ? sessions.get(token) : undefined
  let sessionToken = token as string
  if (!playerId) {
    sessionToken = randomUUID()
    playerId = randomUUID().slice(0, 8)
    sessions.set(sessionToken, playerId)
  }
  socket.data.playerId = playerId
  socket.data.token = sessionToken
  next()
})

io.on('connection', (socket) => {
  const playerId: string = socket.data.playerId
  socket.join(playerRoom(playerId))
  socket.emit('session', { token: socket.data.token, playerId } satisfies SessionMsg)

  socketCount.set(playerId, (socketCount.get(playerId) ?? 0) + 1)
  rooms.setConnected(playerId, true)
  socket.emit('state', rooms.stateFor(playerId))

  // Simple token bucket: 10 messages/sec burst, refills 5/sec.
  let tokens = 10
  let last = Date.now()

  socket.on('c2s', (raw: unknown, ack?: (a: Ack) => void) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    const now = Date.now()
    tokens = Math.min(10, tokens + ((now - last) / 1000) * 5)
    last = now
    if (tokens < 1) return reply({ ok: false, error: 'Slow down' })
    tokens--

    const parsed = ClientMsg.safeParse(raw)
    if (!parsed.success) return reply({ ok: false, error: 'Bad message' })
    const msg = parsed.data
    try {
      switch (msg.t) {
        case 'room:create': rooms.create(playerId, msg.name); break
        case 'room:join': rooms.join(playerId, msg.code, msg.name); break
        case 'room:leave': rooms.leave(playerId); break
        case 'room:settings': rooms.updateSettings(playerId, msg.settings); break
        case 'room:ready': rooms.setReady(playerId, msg.ready); break
        case 'game:start': rooms.start(playerId); break
        case 'game:action': rooms.act(playerId, msg.action); break
        case 'game:backToLobby': rooms.backToLobby(playerId); break
      }
      reply({ ok: true })
    } catch (e) {
      if (e instanceof RoomError) return reply({ ok: false, error: e.message })
      console.error(e)
      reply({ ok: false, error: 'Server error' })
    }
  })

  socket.on('disconnect', () => {
    const n = (socketCount.get(playerId) ?? 1) - 1
    if (n > 0) return void socketCount.set(playerId, n)
    socketCount.delete(playerId)
    rooms.setConnected(playerId, false)
  })
})

http.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`))
