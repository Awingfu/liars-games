import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import type { Ack, ClientMsg, SessionMsg, StateMsg } from '../shared/protocol'

// Per-tab session: refreshing keeps your seat, a new tab is a new player
// (handy for testing multiplayer on one machine).
const TOKEN_KEY = 'liars.token'
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v) } catch {} },
}

export const socket = io({ auth: (cb) => cb({ token: store.get(TOKEN_KEY) }) })
socket.on('session', (s: SessionMsg) => store.set(TOKEN_KEY, s.token))

export async function send(msg: ClientMsg): Promise<Ack> {
  try {
    return await socket.timeout(5000).emitWithAck('c2s', msg)
  } catch {
    return { ok: false, error: 'Server did not respond' }
  }
}

export function useServerState() {
  const [state, setState] = useState<StateMsg | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  useEffect(() => {
    const onState = (s: StateMsg) => setState(s)
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    socket.on('state', onState)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('state', onState)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])
  return { state, connected }
}
