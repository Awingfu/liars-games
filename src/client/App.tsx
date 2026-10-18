import { useEffect, useRef, useState } from 'react'
import type { ClientMsg, RoomSettings, RoomView, StateMsg } from '../shared/protocol'
import { DiceTable } from './DiceTable'
import { send, useServerState } from './socket'

export type Run = (msg: ClientMsg) => Promise<boolean>

const NAME_KEY = 'liars.name'
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
const saveName = (n: string) => { try { localStorage.setItem(NAME_KEY, n) } catch {} }

export function App() {
  const { state, connected } = useServerState()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3500)
    return () => clearTimeout(t)
  }, [error])

  // Keep ?room=CODE in the URL while in a room; drop it after leaving one.
  const wasInRoom = useRef(false)
  const code = state?.room?.code
  useEffect(() => {
    const url = new URL(location.href)
    if (code) url.searchParams.set('room', code)
    else if (wasInRoom.current) url.searchParams.delete('room')
    wasInRoom.current = !!code
    history.replaceState(null, '', url)
  }, [code])

  const run: Run = async (msg) => {
    const r = await send(msg)
    if (!r.ok) setError(r.error)
    return r.ok
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Liar's Dice</h1>
        {!connected && <span className="badge warn">Reconnecting…</span>}
      </header>
      {!state ? (
        <p className="muted center">Connecting…</p>
      ) : !state.room ? (
        <Home run={run} />
      ) : state.room.status === 'lobby' ? (
        <Lobby state={state} room={state.room} run={run} />
      ) : (
        <DiceTable state={state} room={state.room} run={run} />
      )}
      {error && <div className="toast" role="alert">{error}</div>}
    </div>
  )
}

function Home({ run }: { run: Run }) {
  const [name, setName] = useState(savedName)
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const valid = name.trim().length > 0

  const go = (msg: ClientMsg) => {
    saveName(name.trim())
    run(msg)
  }

  return (
    <div className="card narrow">
      <label>
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoFocus />
      </label>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && code.length === 5) go({ t: 'room:join', code, name })
        }}
      >
        <input
          className="code-input"
          value={code}
          maxLength={5}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ROOM CODE"
        />
        <button disabled={!valid || code.length !== 5}>Join</button>
      </form>
      <div className="divider">or</div>
      <button className="primary" disabled={!valid} onClick={() => go({ t: 'room:create', name })}>
        Create a private room
      </button>
    </div>
  )
}

function Lobby({ state, room, run }: { state: StateMsg; room: RoomView; run: Run }) {
  const isHost = room.hostId === state.you
  const me = room.players.find((p) => p.id === state.you)
  const canStart = room.players.length >= 2 && room.players.every((p) => p.id === room.hostId || p.ready)
  const link = `${location.origin}/?room=${room.code}`
  const [copied, setCopied] = useState(false)

  const update = (patch: Partial<RoomSettings['game']> & { turnSeconds?: number }) => {
    const { turnSeconds = room.settings.turnSeconds, ...game } = patch
    run({ t: 'room:settings', settings: { turnSeconds, game: { ...room.settings.game, ...game } } })
  }
  const g = room.settings.game

  return (
    <div className="lobby">
      <div className="card">
        <div className="room-code">
          <span className="muted">Room code</span>
          <strong>{room.code}</strong>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <ul className="players">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'away'}>
              <span>
                {p.name}
                {p.id === state.you && <span className="muted"> (you)</span>}
              </span>
              <span className="muted">
                {p.id === room.hostId ? '👑 host' : p.ready ? '✅ ready' : 'not ready'}
                {!p.connected && ' · away'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Settings</h2>
        <fieldset disabled={!isHost} className="settings">
          <label>
            Starting dice
            <input
              type="number" min={1} max={10} value={g.startingDice}
              onChange={(e) => update({ startingDice: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            />
          </label>
          <label>
            Turn timer
            <select value={room.settings.turnSeconds} onChange={(e) => update({ turnSeconds: Number(e.target.value) })}>
              {[0, 20, 30, 45, 60, 90].map((s) => (
                <option key={s} value={s}>{s ? `${s}s` : 'Off'}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={g.onesWild} onChange={(e) => update({ onesWild: e.target.checked })} />
            1s are wild
          </label>
          <label className="check">
            <input type="checkbox" checked={g.spotOn} onChange={(e) => update({ spotOn: e.target.checked })} />
            Allow "spot on" calls
          </label>
        </fieldset>
        {!isHost && <p className="muted small">Only the host can change settings.</p>}
      </div>

      <div className="actions">
        <button onClick={() => run({ t: 'room:leave' })}>Leave</button>
        {isHost ? (
          <button className="primary" disabled={!canStart} onClick={() => run({ t: 'game:start' })}>
            {room.players.length < 2 ? 'Waiting for players…' : canStart ? 'Start game' : 'Waiting for ready…'}
          </button>
        ) : (
          <button className="primary" onClick={() => run({ t: 'room:ready', ready: !me?.ready })}>
            {me?.ready ? 'Not ready' : "I'm ready"}
          </button>
        )}
      </div>
    </div>
  )
}
