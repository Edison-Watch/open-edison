import { useMemo, useRef, useState, useLayoutEffect } from 'react'
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

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState<number>(12)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 1
      const n = Math.max(1, buckets.entries.length)
      setStep(w / n)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [buckets.entries.length])

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
  const idxOf = (d: string) => buckets.entries.findIndex(([k]) => k === d)
  const selStart = startDay ? clamp(idxOf(startDay), 0, Math.max(0, buckets.entries.length - 1)) : -1
  const selEnd = endDay ? clamp(idxOf(endDay), 0, Math.max(0, buckets.entries.length - 1)) : -1

  const [dragMode, setDragMode] = useState<'none' | 'create' | 'move' | 'resize-l' | 'resize-r'>('none')
  const dragStartIdx = useRef<number>(-1)
  const dragSelRef = useRef<{ a: number; b: number }>({ a: -1, b: -1 })

  const apply = (a: number, b: number) => {
    const lo = clamp(Math.min(a, b), 0, buckets.entries.length - 1)
    const hi = clamp(Math.max(a, b), 0, buckets.entries.length - 1)
    const s = buckets.entries[lo]?.[0] ?? ''
    const e = buckets.entries[hi]?.[0] ?? ''
    if (s && e) onRangeChange(s, e)
  }

  const onCellDown = (idx: number) => {
    setDragMode('create')
    dragStartIdx.current = idx
    apply(idx, idx)
  }
  const onMove = (clientX: number) => {
    if (dragMode === 'none') return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rel = clamp(clientX - rect.left, 0, rect.width)
    const idx = clamp(Math.floor(rel / step), 0, buckets.entries.length - 1)
    if (dragMode === 'create') {
      apply(dragStartIdx.current, idx)
    } else if (dragMode === 'move') {
      const span = dragSelRef.current.b - dragSelRef.current.a
      let newA = clamp(idx - dragStartIdx.current, 0, buckets.entries.length - 1)
      let newB = clamp(newA + span, 0, buckets.entries.length - 1)
      if (newB - newA !== span) {
        // Clamp shift at edges
        newA = Math.max(0, buckets.entries.length - 1 - span)
        newB = newA + span
      }
      apply(newA, newB)
    } else if (dragMode === 'resize-l') {
      apply(idx, dragSelRef.current.b)
    } else if (dragMode === 'resize-r') {
      apply(dragSelRef.current.a, idx)
    }
  }

  const clearDrag = () => { setDragMode('none'); dragStartIdx.current = -1 }

  if (buckets.entries.length === 0) return null

  const haveSel = selStart >= 0 && selEnd >= 0 && selStart <= selEnd
  const selLeft = haveSel ? selStart * step : 0
  const selWidth = haveSel ? (selEnd - selStart + 1) * step : 0

  return (
    <div className="card select-none">
      <div className="text-xs text-app-muted mb-2">Timeline (drag to select or drag window)</div>
      <div
        ref={containerRef}
        className="relative"
        onMouseLeave={() => clearDrag()}
        onMouseUp={() => clearDrag()}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseDown={(e) => {
          // Click background clears selection
          if (!haveSel) return
          const el = containerRef.current
          if (!el) return
          const rect = el.getBoundingClientRect()
          const rel = e.clientX - rect.left
          const idx = clamp(Math.floor(rel / step), 0, buckets.entries.length - 1)
          dragStartIdx.current = idx
        }}
      >
        {/* Bars grid */}
        <div className="grid items-end" style={{ gridTemplateColumns: `repeat(${buckets.entries.length}, 1fr)`, columnGap: 4, height: 80 }}>
          {buckets.entries.map(([day, count], idx) => {
            const h = Math.max(6, (count / buckets.max) * 64)
            const inSelection = haveSel && idx >= selStart && idx <= selEnd
            return (
              <div key={day} className="flex flex-col items-center">
                <div
                  className={`rounded-t w-full cursor-pointer ${inSelection ? 'bg-app-accent' : 'bg-app-border hover:bg-app-accent/60'}`}
                  style={{ height: `${h}px` }}
                  onMouseDown={() => onCellDown(idx)}
                  title={`${day}: ${count}`}
                />
                <div className="text-[10px] text-app-muted mt-1">{day.slice(5)}</div>
              </div>
            )
          })}
        </div>

        {/* Selection overlay with drag handles */}
        {haveSel && (
          <div
            className="absolute top-0 h-[80px]"
            style={{ left: selLeft, width: selWidth }}
          >
            <div
              className="absolute inset-0 bg-app-accent/20 border border-app-accent rounded"
              onMouseDown={(e) => {
                e.stopPropagation()
                setDragMode('move')
                // store initial offset index inside selection
                const el = containerRef.current
                if (!el) return
                const rect = el.getBoundingClientRect()
                const rel = clamp(e.clientX - rect.left, 0, rect.width)
                dragStartIdx.current = clamp(Math.floor(rel / step) - selStart, 0, buckets.entries.length - 1)
                dragSelRef.current = { a: selStart, b: selEnd }
              }}
            />
            {/* Left handle */}
            <div
              className="absolute left-[-4px] top-0 h-full w-2 bg-app-accent cursor-ew-resize rounded"
              onMouseDown={(e) => { e.stopPropagation(); setDragMode('resize-l'); dragSelRef.current = { a: selStart, b: selEnd } }}
            />
            {/* Right handle */}
            <div
              className="absolute right-[-4px] top-0 h-full w-2 bg-app-accent cursor-ew-resize rounded"
              onMouseDown={(e) => { e.stopPropagation(); setDragMode('resize-r'); dragSelRef.current = { a: selStart, b: selEnd } }}
            />
          </div>
        )}
      </div>
    </div>
  )
}


