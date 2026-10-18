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
