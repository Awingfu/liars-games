import { useEffect, useRef, useState } from 'react'
import { GAME_NAMES, GAME_TYPES, type ClientMsg, type RoomSettings, type RoomView, type StateMsg } from '../shared/protocol'
import { DiceTable } from './DiceTable'
import { PokerTable } from './PokerTable'
import { copyText } from './common'
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
        <h1>{state?.room ? GAME_NAMES[state.game?.game ?? state.room.settings.game] : "Liar's Dice & Poker"}</h1>
        {!connected && <span className="badge warn">Reconnecting…</span>}
      </header>
      {!state ? (
        <p className="muted center">Connecting…</p>
      ) : !state.room ? (
        <Home run={run} />
      ) : state.room.status === 'lobby' ? (
        <Lobby state={state} room={state.room} run={run} />
      ) : state.game?.game === 'poker' ? (
        <PokerTable state={state} room={state.room} run={run} />
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
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const linkRef = useRef<HTMLInputElement>(null)

  const update = (patch: Partial<RoomSettings>) => run({ t: 'room:settings', settings: { ...room.settings, ...patch } })
  const { dice, poker } = room.settings
  const clamp = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo))

  return (
    <div className="lobby">
      <div className="card">
        <div className="room-code">
          <span className="muted">Room code</span>
          <strong>{room.code}</strong>
          <button
            onClick={async () => {
              const ok = await copyText(link)
              setCopied(ok ? 'ok' : 'fail')
              if (!ok) linkRef.current?.select()
              setTimeout(() => setCopied('idle'), 2000)
            }}
          >
            {copied === 'ok' ? 'Copied!' : copied === 'fail' ? 'Copy it below ↓' : 'Copy invite link'}
          </button>
        </div>
        <input
          ref={linkRef}
          className="invite-link"
          readOnly
          value={link}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
        />
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
          <div className="segmented" role="radiogroup" aria-label="Game">
            {GAME_TYPES.map((t) => (
              <button
                key={t} type="button" role="radio" aria-checked={room.settings.game === t}
                className={room.settings.game === t ? 'selected' : ''}
                onClick={() => update({ game: t })}
              >
                {GAME_NAMES[t]}
              </button>
            ))}
          </div>
          {room.settings.game === 'dice' ? (
            <>
              <label>
                Starting dice
                <input
                  type="number" min={1} max={10} value={dice.startingDice}
                  onChange={(e) => update({ dice: { ...dice, startingDice: clamp(e.target.value, 1, 10) } })}
                />
              </label>
              <TimerSelect value={room.settings.turnSeconds} onChange={(turnSeconds) => update({ turnSeconds })} />
              <div className="option">
                <label className="check">
                  <input type="checkbox" checked={dice.onesWild} onChange={(e) => update({ dice: { ...dice, onesWild: e.target.checked } })} />
                  1s are wild
                </label>
                <p className="hint">
                  1s count toward every bid, so "five 4s" counts all 4s <em>and</em> all 1s. The only exception is a bid
                  on 1s themselves, which counts just the 1s. You can't open on 1s. Switching to 1s needs at least half
                  the current quantity (rounded up), e.g. 6×4s → 3×1s. Switching back needs double plus one, e.g. 3×1s → 7×anything.
                </p>
              </div>
              <div className="option">
                <label className="check">
                  <input type="checkbox" checked={dice.spotOn} onChange={(e) => update({ dice: { ...dice, spotOn: e.target.checked } })} />
                  Allow "spot on" calls
                </label>
                <p className="hint">
                  On your turn, instead of calling Liar, you can claim the current bid is <em>exactly</em> right. If the
                  count matches exactly, you get a die back (up to the starting number). If it's off in either direction,
                  you lose a die.
                </p>
              </div>
            </>
          ) : (
            <>
              <label>
                Starting cards
                <input
                  type="number" min={1} max={poker.maxCards} value={poker.startingCards}
                  onChange={(e) => update({ poker: { ...poker, startingCards: clamp(e.target.value, 1, poker.maxCards) } })}
                />
              </label>
              <label>
                Out after
                <select
                  value={poker.maxCards}
                  onChange={(e) => {
                    const maxCards = Number(e.target.value)
                    update({ poker: { maxCards, startingCards: Math.min(poker.startingCards, maxCards) } })
                  }}
                >
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>more than {n} cards</option>)}
                </select>
              </label>
              <TimerSelect value={room.settings.turnSeconds} onChange={(turnSeconds) => update({ turnSeconds })} />
            </>
          )}
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

function TimerSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label>
      Turn timer
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[0, 20, 30, 45, 60, 90].map((s) => (
          <option key={s} value={s}>{s ? `${s}s` : 'Off'}</option>
        ))}
      </select>
    </label>
  )
}
