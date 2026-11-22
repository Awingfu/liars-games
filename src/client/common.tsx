import { useEffect, useState } from 'react'

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
export function BotTips({ game }: { game: 'dice' | 'poker' }) {
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
