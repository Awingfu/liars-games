import { useEffect, useState } from 'react'

export function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.ceil((deadline - now) / 1000))
  return <span className={`timer${s <= 5 ? ' urgent' : ''}`}>{s}s</span>
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
