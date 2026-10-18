import { useEffect, useMemo, useState } from 'react'
import {
  CLAIM_TYPES,
  SUITS,
  claimError,
  compareClaims,
  describeClaim,
  rankName,
  type Card,
  type Claim,
  type PokerRoundResult,
  type PokerView,
  type Suit,
} from '../shared/games/liarsPoker'
import type { RoomView, StateMsg } from '../shared/protocol'
import type { Run } from './App'
import { Countdown } from './common'

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const ALL_SUITS: Suit[] = [0, 1, 2, 3]

const TYPE_LABELS: Record<Claim['type'], string> = {
  high: 'High card',
  pair: 'Pair',
  twoPair: 'Two pair',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  fullHouse: 'Full house',
  quads: 'Four of a kind',
  straightFlush: 'Straight flush',
}

type RankKey = 'rank' | 'high' | 'low' | 'trips' | 'pair'
type Field = { key: RankKey; label: string; min?: number } | { key: 'suit'; label: string }

const FIELDS: Record<Claim['type'], Field[]> = {
  high: [{ key: 'rank', label: 'Rank' }],
  pair: [{ key: 'rank', label: 'Rank' }],
  twoPair: [{ key: 'high', label: 'Higher pair' }, { key: 'low', label: 'Lower pair' }],
  trips: [{ key: 'rank', label: 'Rank' }],
  straight: [{ key: 'high', label: 'Up to', min: 5 }],
  flush: [{ key: 'suit', label: 'Suit' }, { key: 'high', label: 'High card', min: 6 }],
  fullHouse: [{ key: 'trips', label: 'Three of', min: 2 }, { key: 'pair', label: 'Pair of' }],
  quads: [{ key: 'rank', label: 'Rank' }],
  straightFlush: [{ key: 'suit', label: 'Suit' }, { key: 'high', label: 'Up to', min: 5 }],
}

/** Every structurally valid claim, lowest first. */
const ALL_CLAIMS: Claim[] = (() => {
  const out: Claim[] = []
  for (const rank of RANKS) out.push({ type: 'high', rank }, { type: 'pair', rank }, { type: 'trips', rank }, { type: 'quads', rank })
  for (const high of RANKS) {
    for (const low of RANKS) {
      if (low < high) out.push({ type: 'twoPair', high, low })
      if (low !== high) out.push({ type: 'fullHouse', trips: high, pair: low })
    }
    if (high >= 5) out.push({ type: 'straight', high })
    for (const suit of ALL_SUITS) {
      if (high >= 6) out.push({ type: 'flush', suit, high })
      if (high >= 5) out.push({ type: 'straightFlush', suit, high })
    }
  }
  return out.sort(compareClaims)
})()

const lowestAbove = (bid: Claim | null, type?: Claim['type']) =>
  ALL_CLAIMS.find((c) => (!type || c.type === type) && (!bid || compareClaims(c, bid) > 0))

const isRed = (s: Suit) => s === 1 || s === 2

function PlayingCard({ card, hit }: { card: Card; hit?: boolean }) {
  return (
    <span className={`card-face${isRed(card.suit) ? ' red' : ''}${hit ? ' hit' : ''}`}>
      {rankName(card.rank)}
      {SUITS[card.suit]}
    </span>
  )
}

/** Cards that contribute to a claim, for highlighting on reveal. */
function relevant(c: Claim, card: Card): boolean {
  const straight = (high: number) => [0, 1, 2, 3, 4].map((i) => (high - i === 1 ? 14 : high - i))
  switch (c.type) {
    case 'high': case 'pair': case 'trips': case 'quads': return card.rank === c.rank
    case 'twoPair': return card.rank === c.high || card.rank === c.low
    case 'fullHouse': return card.rank === c.trips || card.rank === c.pair
    case 'straight': return straight(c.high).includes(card.rank)
    case 'flush': return card.suit === c.suit && card.rank <= c.high
    case 'straightFlush': return card.suit === c.suit && straight(c.high).includes(card.rank)
  }
}

export function PokerTable({ state, room, run }: { state: StateMsg; room: RoomView; run: Run }) {
  const g = state.game as PokerView
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '?'
  const me = g.players.find((p) => p.id === state.you)
  const myTurn = g.turnPlayerId === state.you
  const isHost = room.hostId === state.you

  return (
    <div className="table">
      <div className="table-head">
        <span>Round {g.round} · {g.totalCards} cards in play · out after {g.config.maxCards}</span>
        <button className="small-btn" onClick={() => confirm('Leave this game? You will forfeit.') && run({ t: 'room:leave' })}>
          Leave
        </button>
      </div>

      <ul className="seats">
        {g.players.map((p) => {
          const rp = room.players.find((r) => r.id === p.id)
          const last = [...g.history].reverse().find((b) => b.by === p.id)
          return (
            <li key={p.id} className={[g.turnPlayerId === p.id && 'turn', p.cardCount === 0 && 'out', !rp?.connected && 'away'].filter(Boolean).join(' ')}>
              <div className="seat-name">
                {nameOf(p.id)}
                {p.id === state.you && <span className="muted"> (you)</span>}
                {rp?.left ? <span className="muted"> · left</span> : !rp?.connected && <span className="muted"> · away</span>}
              </div>
              <div className="seat-dice">
                {p.cardCount === 0 ? <span className="muted">out</span> : Array.from({ length: p.cardCount }, (_, i) => <span key={i} className="card-back" />)}
              </div>
              {last && g.phase === 'bidding' && <div className="seat-bid">{describeClaim(last.claim)}</div>}
            </li>
          )
        })}
      </ul>

      <div className="center-bid">
        {g.bid ? (
          <>
            <div className="muted small">{nameOf(g.bid.by)} says there's</div>
            <div className="big">{describeClaim(g.bid.claim)}</div>
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

      {me?.hand && me.hand.length > 0 && g.phase === 'bidding' && (
        <div className="my-hand">
          <div className="muted small">Your cards</div>
          <div className="dice-row">{me.hand.map((c, i) => <PlayingCard key={i} card={c} hit={!!g.bid && relevant(g.bid.claim, c)} />)}</div>
        </div>
      )}

      {myTurn && <ClaimPicker view={g} run={run} />}

      {g.history.length > 0 && g.phase === 'bidding' && (
        <details className="history">
          <summary>Bid history ({g.history.length})</summary>
          <ol>{g.history.map((b, i) => <li key={i}>{nameOf(b.by)}: {describeClaim(b.claim)}</li>)}</ol>
        </details>
      )}
    </div>
  )
}

function ClaimPicker({ view: g, run }: { view: PokerView; run: Run }) {
  const current = g.bid?.claim ?? null
  // Server sends a fresh object each update; key the default on its content.
  const currentKey = JSON.stringify(current)
  const initial = useMemo(() => lowestAbove(current), [currentKey])
  const [claim, setClaim] = useState<Claim | undefined>(initial)
  useEffect(() => setClaim(initial), [initial])

  if (!claim) {
    return (
      <div className="card controls">
        <p>Nothing beats a royal flush in ♠. Call it!</p>
        <button className="danger" onClick={() => run({ t: 'game:action', action: { type: 'call' } })}>Liar!</button>
      </div>
    )
  }

  const pickType = (type: Claim['type']) => setClaim(lowestAbove(current, type) ?? ALL_CLAIMS.find((c) => c.type === type))
  const set = (key: string, value: number) => setClaim({ ...claim, [key]: value } as Claim)
  const problem = claimError(claim) ?? (current && compareClaims(claim, current) <= 0 ? 'Must beat the current bid' : null)
  const typeAvailable = (t: Claim['type']) => !!lowestAbove(current, t)

  return (
    <div className="card controls">
      <div className="hand-types">
        {CLAIM_TYPES.map((t) => (
          <button key={t} className={claim.type === t ? 'selected' : ''} disabled={!typeAvailable(t)} onClick={() => pickType(t)}>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {FIELDS[claim.type].map((f) => {
        const value = (claim as unknown as Record<string, number>)[f.key]
        return (
          <div key={f.key} className="field">
            <span className="muted small">{f.label}</span>
            <div className={f.key === 'suit' ? 'suit-row' : 'rank-row'}>
              {f.key === 'suit'
                ? ALL_SUITS.map((s) => (
                    <button key={s} className={`${value === s ? 'selected' : ''}${isRed(s) ? ' red' : ''}`} onClick={() => set('suit', s)}>
                      {SUITS[s]}
                    </button>
                  ))
                : RANKS.filter((r) => r >= (f.min ?? 2)).map((r) => (
                    <button key={r} className={value === r ? 'selected' : ''} onClick={() => set(f.key, r)}>
                      {rankName(r)}
                    </button>
                  ))}
            </div>
          </div>
        )
      })}
      <div className="row actions">
        <button className="primary" disabled={!!problem} onClick={() => run({ t: 'game:action', action: { type: 'bid', claim } })}>
          {problem ?? `Bid ${describeClaim(claim)}`}
        </button>
        {g.bid && <button className="danger" onClick={() => run({ t: 'game:action', action: { type: 'call' } })}>Liar!</button>}
      </div>
    </div>
  )
}

function Reveal({ result: r, view: g, nameOf, you }: { result: PokerRoundResult; view: PokerView; nameOf: (id: string) => string; you: string }) {
  const who = (id: string) => (id === you ? 'You' : nameOf(id))
  const loser = who(r.loserId)
  const outcome = r.eliminatedId
    ? `${loser} ${r.loserId === you ? 'are' : 'is'} out!`
    : `${loser} ${r.loserId === you ? 'get' : 'gets'} an extra card.`

  return (
    <div className="card reveal">
      <p>
        <strong>{who(r.callerId)}</strong> called Liar on {nameOf(r.bid.by)}'s <strong>{describeClaim(r.bid.claim)}</strong> — it{' '}
        <strong>{r.existed ? 'was there' : "wasn't there"}</strong>. {outcome}
      </p>
      <ul className="hands">
        {Object.entries(r.hands).filter(([, h]) => h.length).map(([id, hand]) => (
          <li key={id}>
            <span className="hand-name">{nameOf(id)}</span>
            <span className="dice-row">{hand.map((c, i) => <PlayingCard key={i} card={c} hit={relevant(r.bid.claim, c)} />)}</span>
          </li>
        ))}
      </ul>
      {g.phase === 'reveal' && <p className="muted small">Next round starting…</p>}
    </div>
  )
}
