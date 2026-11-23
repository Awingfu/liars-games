import { useEffect, useMemo, useState } from 'react'
import { isLegalRaise, type Bid, type DiceView, type RoundResult } from '../shared/games/liarsDice'
import type { RoomView, StateMsg } from '../shared/protocol'
import type { Run } from './App'
import { diceOdds } from '../shared/odds'
import { BotTips, Countdown, GameOver, OddsLine, TableHead, displayName, useEzMode } from './common'

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
  const nameOf = (id: string | null) => displayName(room, id)
  const me = g.players.find((p) => p.id === state.you)
  const myTurn = g.turnPlayerId === state.you

  return (
    <div className="table">
      <TableHead room={room} you={state.you} run={run}>Round {g.round} · {g.totalDice} dice in play</TableHead>

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
            {g.phase === 'bidding' && <DiceOdds view={g} you={state.you} bid={g.bid} />}
          </>
        ) : g.phase === 'bidding' ? (
          <div className="muted">{myTurn ? 'You open the bidding' : `${nameOf(g.turnPlayerId)} opens the bidding`}</div>
        ) : null}
        {g.phase === 'bidding' && (
          <div className="turn-line">
            {myTurn ? <strong>Your turn</strong> : <>Waiting for {nameOf(g.turnPlayerId)}</>}
            {room.deadline && <> · <Countdown deadline={room.deadline} /></>}
          </div>
        )}
      </div>

      {g.lastResult && <Reveal result={g.lastResult} view={g} nameOf={nameOf} you={state.you} deadline={room.deadline} />}

      {g.phase === 'over' && (
        <GameOver winnerId={g.winnerId} room={room} you={state.you} run={run} />
      )}

      {me && me.diceCount > 0 && g.phase !== 'over' && (
        <div className="my-hand">
          <div className="muted small">Your dice</div>
          <div className="dice-row">{me.dice?.map((d, i) => <Die key={i} face={d} hit={!!g.bid && counts(g.bid.face, d, g.config.onesWild)} />)}</div>
        </div>
      )}

      {myTurn && <BidControls view={g} you={state.you} run={run} />}

      {g.history.length > 0 && g.phase === 'bidding' && (
        <details className="history">
          <summary>Bid history ({g.history.length})</summary>
          <ol>{g.history.map((b, i) => <li key={i}>{nameOf(b.by)}: {bidText(b)}</li>)}</ol>
        </details>
      )}

      {room.players.some((p) => p.bot) && <BotTips game="dice" />}
    </div>
  )
}

function BidControls({ view: g, you, run }: { view: DiceView; you: string; run: Run }) {
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
      {legal(face) && <DiceOdds view={g} you={you} bid={{ qty, face }} label="Chance your bid is true" />}
      <div className="row actions">
        <button className="primary" disabled={!legal(face)} onClick={() => run({ t: 'game:action', action: { type: 'bid', qty, face } })}>
          Bid {qty} × {FACE_CHARS[face]}
        </button>
        {g.bid && (
          <>
            <button className="danger" aria-label="Liar!" title="The bid is too high. If you're right the bidder loses a die; if not, you do" onClick={() => run({ t: 'game:action', action: { type: 'call' } })}>Liar!</button>
            {g.config.spotOn && (
              <button aria-label="Spot on" title="The bid is exactly right. Get a die back if so, lose one if not" onClick={() => run({ t: 'game:action', action: { type: 'spotOn' } })}>Spot on</button>
            )}
          </>
        )}
      </div>
      {onesWild && (
        <p className="hint table-hint">
          1s are wild: they count toward every face except a bid on 1s. To bid 1s, use at least half the quantity
          (rounded up). To leave 1s, double it plus one.
        </p>
      )}
    </div>
  )
}

/** EZ mode odds for a dice bid: blind, and counting your own dice if you're playing. */
function DiceOdds({ view, you, bid, label }: { view: DiceView; you: string; bid: Bid; label?: string }) {
  const ez = useEzMode()
  if (!ez) return null
  const playing = !!view.players.find((p) => p.id === you)?.dice?.length
  return <OddsLine label={label} blind={diceOdds(view, you, bid, false)} withHand={playing ? diceOdds(view, you, bid, true) : undefined} />
}

function Reveal({ result: r, view: g, nameOf, you, deadline }: { result: RoundResult; view: DiceView; nameOf: (id: string) => string; you: string; deadline: number | null }) {
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
        <strong>{who(r.callerId)}</strong> {call} on {nameOf(r.bid.by)}'s <strong>{bidText(r.bid)}</strong>. There{' '}
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
      {g.phase === 'reveal' && (
        <p className="muted small">
          {deadline ? <>Next round in <Countdown deadline={deadline} urgentAt={0} /></> : 'Next round starting…'}
        </p>
      )}
    </div>
  )
}
