import { useEffect, useState } from 'react'
import { MIA, MIA_VALUES, describeMia, miaDice, miaRank, nextAbove, type MiaAction, type MiaResult, type MiaView } from '../shared/games/mia'
import type { RoomView, StateMsg } from '../shared/protocol'
import type { Run } from './App'
import { miaOdds } from '../shared/odds'
import { BotTips, Countdown, EzNote, GameOver, OddsLine, TableHead, displayName, useEzMode } from './common'

const FACE_CHARS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

function Dice({ value, size }: { value: number; size?: 'big' }) {
  const [a, b] = miaDice(value)
  return (
    <span className={`dice-row mia-dice${size ? ` ${size}` : ''}`} aria-label={`dice ${a} and ${b}`}>
      <span className="die">{FACE_CHARS[a]}</span>
      <span className="die">{FACE_CHARS[b]}</span>
    </span>
  )
}

const label = (v: number) => (v === MIA ? 'Mia (2-1)' : describeMia(v))

export function MiaTable({ state, room, run }: { state: StateMsg; room: RoomView; run: Run }) {
  const g = state.game as MiaView
  const nameOf = (id: string | null) => displayName(room, id)
  const myTurn = g.turnPlayerId === state.you
  const alive = g.players.filter((p) => p.lives > 0).length

  return (
    <div className="table">
      <TableHead room={room} you={state.you} run={run}>Round {g.round} · {alive} players left</TableHead>

      <ul className="seats">
        {g.players.map((p) => {
          const rp = room.players.find((r) => r.id === p.id)
          const last = [...g.history].reverse().find((c) => c.by === p.id)
          return (
            <li key={p.id} className={[g.turnPlayerId === p.id && 'turn', p.lives === 0 && 'out', !rp?.connected && 'away'].filter(Boolean).join(' ')}>
              <div className="seat-name">
                {nameOf(p.id)}
                {p.id === state.you && <span className="muted"> (you)</span>}
                {rp?.left ? <span className="muted"> · left</span> : !rp?.connected && <span className="muted"> · away</span>}
              </div>
              <div className="lives" aria-label={`${p.lives} of ${g.config.lives} lives`}>
                {p.lives === 0 ? <span className="muted">out</span> : '❤️'.repeat(p.lives) + '🖤'.repeat(Math.max(0, g.config.lives - p.lives))}
              </div>
              {last && g.phase === 'bidding' && <div className="seat-bid">{label(last.value)}</div>}
            </li>
          )
        })}
      </ul>

      <div className="center-bid">
        {g.claim ? (
          <>
            <div className="muted small">{nameOf(g.claim.by)} announces</div>
            <div className="big">{label(g.claim.value)}</div>
            {g.phase === 'bidding' && <MiaOdds value={g.claim.value} />}
          </>
        ) : g.phase === 'bidding' ? (
          <div className="muted">{myTurn ? 'You roll first' : `${nameOf(g.turnPlayerId)} rolls first`}</div>
        ) : null}
        {g.phase === 'bidding' && (
          <div className="turn-line">
            {myTurn ? (
              <strong>Your turn</strong>
            ) : g.hasRolled ? (
              <>{nameOf(g.turnPlayerId)} rolled and is deciding what to announce</>
            ) : (
              <>Waiting for {nameOf(g.turnPlayerId)}</>
            )}
            {room.deadline && <> · <Countdown deadline={room.deadline} /></>}
          </div>
        )}
      </div>
      {g.phase === 'bidding' && <EzNote />}

      {g.lastResult && <Reveal result={g.lastResult} phase={g.phase} nameOf={nameOf} you={state.you} deadline={room.deadline} />}

      {g.phase === 'over' && <GameOver winnerId={g.winnerId} room={room} you={state.you} run={run} />}

      {myTurn && <Controls view={g} run={run} />}

      {g.history.length > 0 && g.phase === 'bidding' && (
        <details className="history">
          <summary>Announcements ({g.history.length})</summary>
          <ol>{g.history.map((c, i) => <li key={i}>{nameOf(c.by)}: {label(c.value)}</li>)}</ol>
        </details>
      )}

      {room.players.some((p) => p.bot) && <BotTips game="mia" />}
    </div>
  )
}

function Controls({ view: g, run }: { view: MiaView; run: Run }) {
  const act = (action: MiaAction) => run({ t: 'game:action', action })

  if (g.rolled === null) {
    if (!g.claim)
      return (
        <div className="card controls">
          <div className="row actions"><button className="primary" onClick={() => act({ type: 'roll' })}>Roll the dice</button></div>
        </div>
      )
    if (g.claim.value === MIA)
      return (
        <div className="card controls">
          <p className="center">Nothing beats Mia. Do you believe it?</p>
          <div className="row actions">
            <button className="primary" onClick={() => act({ type: 'giveUp' })}>Give up (lose 1 life)</button>
            <button className="danger" onClick={() => act({ type: 'call' })}>Liar! (lose 2 if it's real)</button>
          </div>
        </div>
      )
    return (
      <div className="card controls">
        <p className="center">Believe {describeMia(g.claim.value)}? Then roll and beat it.</p>
        <div className="row actions">
          <button className="primary" onClick={() => act({ type: 'roll' })}>Believe &amp; roll</button>
          <button className="danger" onClick={() => act({ type: 'call' })}>Liar!</button>
        </div>
      </div>
    )
  }

  return <Announce rolled={g.rolled} claim={g.claim?.value ?? null} act={act} />
}

function Announce({ rolled, claim, act }: { rolled: number; claim: number | null; act: (a: { type: 'claim'; value: number }) => void }) {
  const beats = claim === null || miaRank(rolled) > miaRank(claim)
  const options = MIA_VALUES.filter((v) => claim === null || miaRank(v) > miaRank(claim))
  const [pick, setPick] = useState(beats ? rolled : nextAbove(claim)!)
  useEffect(() => setPick(beats ? rolled : nextAbove(claim)!), [rolled, claim, beats])

  return (
    <div className="card controls">
      <div className="my-hand">
        <div className="muted small">You rolled</div>
        <Dice value={rolled} size="big" />
        <div>{label(rolled)} {beats ? <span className="ok">· beats it</span> : <span className="warn">· not enough, so bluff</span>}</div>
      </div>
      <div className="mia-values">
        {options.map((v) => (
          <button key={v} className={`${pick === v ? 'selected' : ''}${v === rolled ? ' truth' : ''}`} onClick={() => setPick(v)}>
            {v === MIA ? 'Mia' : v}
          </button>
        ))}
      </div>
      <MiaOdds value={pick} label="Chance a fair roll is at least this" />
      <div className="row actions">
        <button className="primary" onClick={() => act({ type: 'claim', value: pick })}>
          Announce {label(pick)}{pick === rolled ? ' (true)' : ''}
        </button>
      </div>
    </div>
  )
}

/** EZ mode odds in Mia: nobody holds anything when judging a claim, so only the fair-roll chance applies. */
function MiaOdds({ value, label = 'Chance a fair roll is at least this' }: { value: number; label?: string }) {
  const ez = useEzMode()
  return ez ? <OddsLine label={label} blind={miaOdds(value)} /> : null
}

function Reveal({ result: r, phase, nameOf, you, deadline }: { result: MiaResult; phase: MiaView['phase']; nameOf: (id: string) => string; you: string; deadline: number | null }) {
  const who = (id: string) => (id === you ? 'You' : nameOf(id))
  const lose = (id: string) => (id === you ? 'lose' : 'loses')
  const lives = r.livesLost === 1 ? 'a life' : `${r.livesLost} lives`
  return (
    <div className="card reveal">
      {r.kind === 'giveUp' ? (
        <p>
          <strong>{who(r.callerId)}</strong> gave up against {nameOf(r.claim.by)}'s Mia and {lose(r.callerId)} a life.
        </p>
      ) : (
        <>
          <p>
            <strong>{who(r.callerId)}</strong> called Liar on {nameOf(r.claim.by)}'s <strong>{label(r.claim.value)}</strong>.
            It was <strong>{label(r.actual!)}</strong>. {who(r.loserId)} {lose(r.loserId)} {lives}.
          </p>
          <div className="center"><Dice value={r.actual!} /></div>
        </>
      )}
      {r.eliminatedId && <p className="muted">{who(r.eliminatedId)} {r.eliminatedId === you ? 'are' : 'is'} out.</p>}
      {phase === 'reveal' && (
        <p className="muted small">
          {deadline ? <>Next round in <Countdown deadline={deadline} urgentAt={0} /></> : 'Next round starting…'}
        </p>
      )}
    </div>
  )
}
