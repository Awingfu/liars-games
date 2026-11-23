import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { RoomView, ScoreView } from '../shared/protocol'
import { pct } from '../shared/odds'
import type { Run } from './App'

export function Countdown({ deadline, urgentAt = 5 }: { deadline: number; urgentAt?: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.ceil((deadline - now) / 1000))
  return <span className={`timer${s <= urgentAt ? ' urgent' : ''}`}>{s}s</span>
}

/**
 * Copy text, falling back to a hidden textarea when the async Clipboard API is
 * missing or refuses (e.g. the page was opened over plain http on a LAN IP).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try { ok = document.execCommand('copy') } catch {}
  ta.remove()
  return ok
}

/** Collapsible explainer for how bots play, shown wherever bots are in the room. */
export function BotTips({ game }: { game: 'dice' | 'poker' | 'mia' }) {
  if (game === 'mia')
    return (
      <details className="history bot-tips">
        <summary>🤖 How the bots play</summary>
        <ul>
          <li>Bots only see their own roll, and only after they've rolled. They never peek under the cup.</li>
          <li>They call when the announcement looks less likely to be true than their chances of beating it.</li>
          <li>When they roll well enough they usually tell the truth; otherwise they lie just above the last announcement.</li>
          <li>Against Mia they call only when they doubt it enough to risk losing 2 lives.</li>
          <li>
            <strong>Easy</strong> misjudges the odds and sometimes inflates a good roll. <strong>Normal</strong> takes
            each announcement at face value. <strong>Hard</strong> reads announcements: one just barely above the last
            looks like a lie, a big jump looks honest.
          </li>
          <li>
            <strong>Tip:</strong> against Hard, lie with a jump rather than the minimum; it's suspicious of small steps.
          </li>
        </ul>
      </details>
    )
  return (
    <details className="history bot-tips">
      <summary>🤖 How the bots play</summary>
      <ul>
        <li>Bots only see their own {game === 'dice' ? 'dice' : 'cards'}, just like you. They never peek.</li>
        <li>
          {game === 'dice'
            ? 'They work out the odds of each bid from their own dice, treating everyone else’s as random rolls.'
            : 'They deal out the unseen cards at random hundreds of times and count how often each hand turns up.'}
        </li>
        <li>They raise by the smallest amount they think is likely enough, and call when calling has better odds.</li>
        {game === 'dice' && <li>With "spot on" on, they use it when the exact count is the most likely result.</li>}
        <li>
          <strong>Easy</strong> misjudges the odds, bluffs often (about 1 in 3) and opens timidly.{' '}
          <strong>Normal</strong> plays the odds straight and bluffs about 1 in 7.{' '}
          <strong>Hard</strong> also reads your bids: it assumes you hold some of what you bid on, and bluffs about 1 in 10.
        </li>
        <li>
          <strong>Tip:</strong> Easy and Normal ignore what your bids say about your hand, so a confident bluff works
          on them. Against Hard, bidding on something you don't hold makes it believe you, which you can use too.
        </li>
      </ul>
    </details>
  )
}

/** Wins per player across every game played in this room. */
export function Scoreboard({ scores, you }: { scores: ScoreView[]; you: string }) {
  return (
    <div className="card scoreboard">
      <h2>Scoreboard</h2>
      <table>
        <thead>
          <tr><th>Player</th><th className="num">Wins</th><th className="num">Games</th></tr>
        </thead>
        <tbody>
          {scores.map((s, i) => (
            <tr key={s.id} className={s.id === you ? 'you' : ''}>
              <td>{i === 0 && s.wins > 0 ? '🏆 ' : ''}{s.name}{s.id === you ? ' (you)' : ''}</td>
              <td className="num">{s.wins}</td>
              <td className="num">{s.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Top line of a game table: status text, a watching badge for spectators, and Leave. */
export function TableHead({ children, room, you, run }: { children: ReactNode; room: RoomView; you: string; run: Run }) {
  const watching = room.players.find((p) => p.id === you)?.spectator
  return (
    <div className="table-head">
      <span>{children}</span>
      <span className="row">
        {watching && <span className="watching-badge">Watching · you'll play next game</span>}
        <button
          className="small-btn"
          onClick={() => (watching || confirm('Leave this game? You will forfeit.')) && run({ t: 'room:leave' })}
        >
          Leave
        </button>
      </span>
    </div>
  )
}

/** Winner banner, the room's scoreboard, and the host's way back to the lobby. */
export function GameOver({ winnerId, room, you, run }: { winnerId: string | null; room: RoomView; you: string; run: Run }) {
  const name = displayName(room, winnerId)
  return (
    <div className="card winner">
      <div className="big">🏆 {winnerId === you ? 'You win!' : `${name} wins!`}</div>
      {room.scores.length > 0 && <Scoreboard scores={room.scores} you={you} />}
      {room.hostId === you ? (
        <button className="primary" onClick={() => run({ t: 'game:backToLobby' })}>Back to lobby</button>
      ) : (
        <p className="muted">Waiting for the host to start another game…</p>
      )}
    </div>
  )
}

/** A player's name as shown at the table; bots carry their level, e.g. "Bot 1 (Hard)". */
export function displayName(room: RoomView, id: string | null): string {
  const p = room.players.find((p) => p.id === id)
  if (!p) return room.scores.find((s) => s.id === id)?.name ?? '?'
  return p.bot ? `${p.name} (${p.bot[0]!.toUpperCase()}${p.bot.slice(1)})` : p.name
}

/** Whether the room has EZ mode on (a lobby setting, the same for everyone). Provided by App around the table. */
export const EzContext = createContext(false)
export const useEzMode = () => useContext(EzContext)

/** Shown at the table while EZ mode is on, so nobody's surprised everyone can see the odds. */
export function EzNote() {
  return useEzMode() ? <p className="ez-note">EZ mode is on: everyone sees the odds</p> : null
}

/** "Chance it's true: blind 34% · with your hand 61%". Omit `withHand` when you hold nothing relevant. */
export function OddsLine({ label = "Chance it's true", blind, withHand }: { label?: string; blind: number; withHand?: number }) {
  return (
    <div className="odds">
      {label}: <span title="Treating every die or card as unseen">blind <strong>{pct(blind)}</strong></span>
      {withHand !== undefined && (
        <> · <span title="Counting what you hold">with your hand <strong>{pct(withHand)}</strong></span></>
      )}
    </div>
  )
}
