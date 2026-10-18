import { useEffect, useMemo, useState } from 'react'
import { isLegalRaise, type Bid, type DiceView, type RoundResult } from '../shared/games/liarsDice'
import type { RoomView, StateMsg } from '../shared/protocol'
import type { Run } from './App'
import { Countdown } from './common'

const FACE_CHARS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

function Die({ face, hit, hidden }: { face?: number; hit?: boolean; hidden?: boolean }) {
  return (
    <span className={`die${hit ? ' hit' : ''}${hidden ? ' hidden' : ''}`} aria-label={hidden ? 'hidden die' : `die ${face}`}>
      {hidden ? '?' : FACE_CHARS[face!]}
    </span>
  )
}

const bidText = (b: Bid) => `${b.qty} × ${FACE_CHARS[b.face]}`
const counts = (face: number, die: number, onesWild: boolean) => die === face || (onesWild && face !== 1 && die === 1)

/** Smallest legal raise, used as the default bid-picker selection. */
function minRaise(bid: Bid | null, onesWild: boolean, total: number): Bid | null {
  for (let qty = 1; qty <= total; qty++)
    for (let face = 1; face <= 6; face++) if (isLegalRaise(bid, { qty, face }, onesWild)) return { qty, face }
  return null
}

export function DiceTable({ state, room, run }: { state: StateMsg; room: RoomView; run: Run }) {
  const g = state.game as DiceView
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '?'
  const me = g.players.find((p) => p.id === state.you)
  const myTurn = g.turnPlayerId === state.you
  const isHost = room.hostId === state.you

  return (
    <div className="table">
      <div className="table-head">
        <span>Round {g.round} · {g.totalDice} dice in play</span>
        <button className="small-btn" onClick={() => confirm('Leave this game? You will forfeit.') && run({ t: 'room:leave' })}>
          Leave
        </button>
      </div>

      <ul className="seats">
        {g.players.map((p) => {
          const rp = room.players.find((r) => r.id === p.id)
          const last = [...g.history].reverse().find((b) => b.by === p.id)
          return (
            <li key={p.id} className={[g.turnPlayerId === p.id && 'turn', p.diceCount === 0 && 'out', !rp?.connected && 'away'].filter(Boolean).join(' ')}>
              <div className="seat-name">
                {nameOf(p.id)}
                {p.id === state.you && <span className="muted"> (you)</span>}
                {rp?.left ? <span className="muted"> · left</span> : !rp?.connected && <span className="muted"> · away</span>}
              </div>
              <div className="seat-dice">
                {p.diceCount === 0 ? <span className="muted">out</span> : Array.from({ length: p.diceCount }, (_, i) => <span key={i} className="pip" />)}
              </div>
              {last && g.phase === 'bidding' && <div className="seat-bid">{bidText(last)}</div>}
            </li>
          )
        })}
      </ul>

      <div className="center-bid">
        {g.bid ? (
          <>
            <div className="muted small">{nameOf(g.bid.by)} bids</div>
            <div className="big">{bidText(g.bid)}</div>
          </>
        ) : g.phase === 'bidding' ? (
          <div className="muted">{myTurn ? 'You open the bidding' : `${nameOf(g.turnPlayerId)} opens the bidding`}</div>
        ) : null}
        {g.phase === 'bidding' && (
          <div className="turn-line">
            {myTurn ? <strong>Your turn</strong> : <>Waiting for {nameOf(g.turnPlayerId)}</>}
            {room.turnDeadline && <> · <Countdown deadline={room.turnDeadline} /></>}
          </div>
        )}
      </div>

      {g.lastResult && <Reveal result={g.lastResult} view={g} nameOf={nameOf} you={state.you} />}

      {g.phase === 'over' && (
        <div className="card winner">
          <div className="big">🏆 {g.winnerId === state.you ? 'You win!' : `${nameOf(g.winnerId)} wins!`}</div>
          {isHost ? (
            <button className="primary" onClick={() => run({ t: 'game:backToLobby' })}>Back to lobby</button>
          ) : (
            <p className="muted">Waiting for the host to start another game…</p>
          )}
        </div>
      )}

      {me && me.diceCount > 0 && g.phase !== 'over' && (
        <div className="my-hand">
          <div className="muted small">Your dice</div>
          <div className="dice-row">{me.dice?.map((d, i) => <Die key={i} face={d} hit={!!g.bid && counts(g.bid.face, d, g.config.onesWild)} />)}</div>
        </div>
      )}

      {myTurn && <BidControls view={g} run={run} />}

      {g.history.length > 0 && g.phase === 'bidding' && (
        <details className="history">
          <summary>Bid history ({g.history.length})</summary>
          <ol>{g.history.map((b, i) => <li key={i}>{nameOf(b.by)}: {bidText(b)}</li>)}</ol>
        </details>
      )}
    </div>
  )
}

function BidControls({ view: g, run }: { view: DiceView; run: Run }) {
  const { onesWild } = g.config
  // Depend on primitives: every server update sends a fresh `bid` object.
  const [bq, bf] = [g.bid?.qty, g.bid?.face]
  const initial = useMemo(
    () => minRaise(bq ? { qty: bq, face: bf! } : null, onesWild, g.totalDice),
    [bq, bf, onesWild, g.totalDice],
  )
  const [qty, setQty] = useState(initial?.qty ?? 1)
  const [face, setFace] = useState(initial?.face ?? 2)
  useEffect(() => {
    if (initial) { setQty(initial.qty); setFace(initial.face) }
  }, [initial])

  const legal = (f: number, q = qty) => q >= 1 && q <= g.totalDice && isLegalRaise(g.bid, { qty: q, face: f }, onesWild)

  return (
    <div className="card controls">
      <div className="row">
        <span>Quantity</span>
        <button className="step" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <span className="qty">{qty}</span>
        <button className="step" onClick={() => setQty((q) => Math.min(g.totalDice, q + 1))}>+</button>
      </div>
      <div className="faces">
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <button key={f} className={`face${face === f ? ' selected' : ''}`} disabled={!legal(f)} onClick={() => setFace(f)}>
            {FACE_CHARS[f]}
          </button>
        ))}
      </div>
      <div className="row actions">
        <button className="primary" disabled={!legal(face)} onClick={() => run({ t: 'game:action', action: { type: 'bid', qty, face } })}>
          Bid {qty} × {FACE_CHARS[face]}
        </button>
        {g.bid && (
          <>
            <button className="danger" onClick={() => run({ t: 'game:action', action: { type: 'call' } })}>Liar!</button>
            {g.config.spotOn && (
              <button onClick={() => run({ t: 'game:action', action: { type: 'spotOn' } })}>Spot on</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Reveal({ result: r, view: g, nameOf, you }: { result: RoundResult; view: DiceView; nameOf: (id: string) => string; you: string }) {
  const who = (id: string) => (id === you ? 'You' : nameOf(id))
  const call = r.kind === 'call' ? 'called Liar' : 'called Spot on'
  const outcome = r.gainerId
    ? `${who(r.gainerId)} ${r.gainerId === you ? 'gain' : 'gains'} a die!`
    : r.loserId
      ? `${who(r.loserId)} ${r.loserId === you ? 'lose' : 'loses'} a die.`
      : 'Exactly right!'

  return (
    <div className="card reveal">
      <p>
        <strong>{who(r.callerId)}</strong> {call} on {nameOf(r.bid.by)}'s <strong>{bidText(r.bid)}</strong> — there{' '}
        {r.actualCount === 1 ? 'was' : 'were'} <strong>{r.actualCount}</strong>. {outcome}
      </p>
      <ul className="hands">
        {Object.entries(r.hands).filter(([, d]) => d.length).map(([id, dice]) => (
          <li key={id}>
            <span className="hand-name">{nameOf(id)}</span>
            <span className="dice-row">{dice.map((d, i) => <Die key={i} face={d} hit={counts(r.bid.face, d, g.config.onesWild)} />)}</span>
          </li>
        ))}
      </ul>
      {g.phase === 'reveal' && <p className="muted small">Next round starting…</p>}
    </div>
  )
}
