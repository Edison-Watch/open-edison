import React, { useMemo, useRef } from 'react'
import type { Session } from '../types'

export function Timeline({ sessions, startDay, endDay, onRangeChange }: {
  sessions: (Session & { ts?: number; day?: string })[]
  startDay: string
  endDay: string
  onRangeChange: (start: string, end: string) => void
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) {
      const day = (s as any).day as string | undefined
      if (!day) continue
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    const max = entries.reduce((m, [, v]) => Math.max(m, v), 1)
    const indexOf = (d: string) => entries.findIndex(([key]) => key === d)
    return { entries, max, indexOf }
  }, [sessions])

  const dragging = useRef<boolean>(false)
  const startIdxRef = useRef<number>(-1)

  const setSelectionByIndex = (i1: number, i2: number) => {
    const a = Math.max(0, Math.min(i1, i2))
    const b = Math.min(buckets.entries.length - 1, Math.max(i1, i2))
    if (a <= b) {
      const s = buckets.entries?.[a]?.[0] ?? ''
      const e = buckets.entries?.[b]?.[0] ?? ''
      onRangeChange(s, e)
    }
  }

  if (buckets.entries.length === 0) return null

  return (
    <div className="card select-none">
      <div className="text-xs text-app-muted mb-2">Timeline (drag to select)</div>
      <div
        className="flex items-end gap-1"
        onMouseLeave={() => { dragging.current = false; startIdxRef.current = -1 }}
        onMouseUp={() => { dragging.current = false; startIdxRef.current = -1 }}
      >
        {buckets.entries.map(([day, count], idx) => {
          const h = Math.max(6, (count / buckets.max) * 64)
          const inSelection = (!startDay || !endDay)
            ? false
            : day >= startDay && day <= endDay
          return (
            <div key={day} className="flex flex-col items-center">
              <div
                className={`rounded-t w-4 cursor-pointer ${inSelection ? 'bg-app-accent' : 'bg-app-border hover:bg-app-accent/60'}`}
                style={{ height: `${h}px` }}
                onMouseDown={() => { dragging.current = true; startIdxRef.current = idx; setSelectionByIndex(idx, idx) }}
                onMouseEnter={() => { if (dragging.current && startIdxRef.current !== -1) setSelectionByIndex(startIdxRef.current, idx) }}
                onClick={() => { if (!dragging.current) setSelectionByIndex(idx, idx) }}
                title={`${day}: ${count}`}
              />
              <div className="text-[10px] text-app-muted mt-1">{day.slice(5)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


