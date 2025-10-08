import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import type { Session } from '../types'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

function dayFromSession(s: Session): string | null {
    const iso = (s as any).created_at || s.tool_calls[0]?.timestamp
    if (!iso) return null
    try {
        const ts = Date.parse(String(iso))
        if (Number.isNaN(ts)) return null
        return new Date(ts).toISOString().slice(0, 10)
    } catch {
        return null
    }
}

export function DateRangeSlider({
    sessions,
    startTimeLabel: _startTimeLabel,
    endTimeLabel: _endTimeLabel,
    onTimeRangeChange,
    hoverTimeLabel,
    onHoverTimeChange,
    onTimeRangeMsChange,
    nowMs,
    itemLabel = 'sessions',
    value: externalValue,
    onChange: onExternalChange,
    flowsData,
}: {
    sessions: (Session & { day?: string })[]
    startTimeLabel: string
    endTimeLabel: string
    onTimeRangeChange: (start: string, end: string) => void
    hoverTimeLabel?: string | null
    onHoverTimeChange?: (label: string | null) => void
    onTimeRangeMsChange?: (startMs: number, endMs: number) => void
    nowMs?: number
    itemLabel?: string
    value?: [number, number]
    onChange?: (value: [number, number]) => void
    flowsData?: Array<{ timestamp: string; is_ai_provider: number }> // New prop for flow data
}) {
    // Quick ranges dropdown (declare hooks before any early return to keep hook order stable)
    const [open, setOpen] = useState(false)
    const applyRange = (fromIso: string, toIso: string) => {
        onTimeRangeChange(fromIso, toIso)
        // Also emit ms range covering full selected days
        try {
            const sTs = new Date(`${fromIso}T00:00:00`).getTime()
            const eTs = new Date(`${toIso}T23:59:59.999`).getTime() // Use end of day instead of 23:59:59
            if (!Number.isNaN(sTs) && !Number.isNaN(eTs)) {
                const newValue = [Math.min(sTs, eTs), Math.max(sTs, eTs)] as [number, number]
                setValue(newValue)
                onExternalChange?.(newValue) // Call external onChange for controlled components
                onTimeRangeMsChange?.(Math.min(sTs, eTs), Math.max(sTs, eTs))
            }
        } catch { /* noop */ }
        setOpen(false)
    }
    const days = useMemo(() => {
        const set = new Set<string>()
        for (const s of sessions) {
            const day = (s as any).day || dayFromSession(s)
            if (day) set.add(day)
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [sessions])

    // Compute overall time window (intraday) across tool calls and session times
    const [minTs, maxTs] = useMemo(() => {
        let minV = Number.POSITIVE_INFINITY
        let maxV = 0
        for (const s of sessions) {
            const isoS = (s as any).created_at || s.tool_calls[0]?.timestamp
            if (isoS) {
                const t = Date.parse(String(isoS))
                if (!Number.isNaN(t)) { if (t < minV) minV = t; if (t > maxV) maxV = t }
            }
            for (const tc of s.tool_calls) {
                const iso = (tc as any)?.timestamp
                if (!iso) continue
                const t = Date.parse(String(iso))
                if (!Number.isNaN(t)) { if (t < minV) minV = t; if (t > maxV) maxV = t }
            }
        }
        // Always include current time as the right edge (from SSE if provided)
        const nowTs = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now()
        if (nowTs > maxV) maxV = nowTs
        if (!Number.isFinite(minV) || maxV <= minV) {
            const now = Date.now()
            return [now - 24 * 3600_000, now]
        }
        return [minV, maxV]
    }, [sessions, nowMs])

    const [value, setValue] = useState<[number, number]>(() => externalValue || [minTs, maxTs])
    const latestMinMaxRef = useRef<[number, number]>([minTs, maxTs])
    useEffect(() => { latestMinMaxRef.current = [minTs, maxTs] }, [minTs, maxTs])

    // Live anchoring: when a live quick-range is selected, keep right edge at now
    const [liveWindowMs, setLiveWindowMs] = useState<number | null>(null)
    const [isManuallyDragging, setIsManuallyDragging] = useState(false)

    // Sync external value with internal state
    useEffect(() => {
        if (externalValue && !isManuallyDragging && (externalValue[0] !== value[0] || externalValue[1] !== value[1])) {
            setValue(externalValue)
        }
    }, [externalValue, isManuallyDragging])
    useEffect(() => {
        if (liveWindowMs == null || isManuallyDragging) return
        const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now()
        // For live ranges, don't clamp to data bounds - allow any range up to now
        const a = now - liveWindowMs
        const b = now
        if (value[0] !== a || value[1] !== b) {
            setValue([a, b])
            const sa = new Date(a).toISOString().slice(0, 10)
            const sb = new Date(b).toISOString().slice(0, 10)
            onTimeRangeMsChange?.(a, b)
            if (sa && sb) onTimeRangeChange(sa, sb)
        }
    }, [nowMs, liveWindowMs, isManuallyDragging])

    // Clamp current value to new bounds if sessions update or now advances
    // DISABLED: This was causing handles to snap and not be draggable
    // useEffect(() => {
    //     const [curA, curB] = value
    //     const a = Math.max(minTs, Math.min(curA, maxTs))
    //     const b = Math.max(a, Math.min(curB, maxTs))
    //     if (a !== curA || b !== curB) setValue([a, b])
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [minTs, maxTs])

    // Sync external start/end to slider values (snap to day boundaries but slider stays continuous)
    // DISABLED: This was causing handles to snap and not be draggable
    // useEffect(() => {
    //     if (!days.length) return
    //     const s = startTimeLabel || days[0]!
    //     const e = endTimeLabel || days[days.length - 1]!
    //     const sTs = new Date(`${s}T00:00:00`).getTime()
    //     const eTs = new Date(`${e}T23:59:59`).getTime()
    //     if (!Number.isNaN(sTs) && !Number.isNaN(eTs)) {
    //         const next: [number, number] = [Math.min(sTs, eTs), Math.max(sTs, eTs)]
    //         if (next[0] !== value[0] || next[1] !== value[1]) setValue(next)
    //     }
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [startTimeLabel, endTimeLabel, days.join(',')])

    const marks = useMemo(() => {
        const out: Record<number, string> = {}
        if (!days.length) return out
        const maxLabels = 12
        const step = Math.max(1, Math.ceil(days.length / maxLabels))
        for (let i = 0; i < days.length; i += step) {
            const d = days[i]!
            const ts = new Date(`${d}T00:00:00`).getTime()
            if (!Number.isNaN(ts)) out[ts] = d.slice(5)
        }
        const last = days[days.length - 1]!
        const lastTs = new Date(`${last}T00:00:00`).getTime()
        if (!Number.isNaN(lastTs)) out[lastTs] = last.slice(5)
        out[minTs] = 'Any time'
        out[maxTs] = 'Now'
        return out
    }, [days, minTs, maxTs])

    // Histogram of sessions/flows per day for inline context
    const histogram = useMemo(() => {
        const counts = new Map<string, number>()

        if (flowsData) {
            // Use flows data for histogram
            for (const flow of flowsData) {
                const day = new Date(Date.parse(flow.timestamp)).toISOString().slice(0, 10)
                counts.set(day, (counts.get(day) ?? 0) + 1)
            }
        } else {
            // Use sessions data for histogram
            for (const s of sessions) {
                const d = (s as any).day || dayFromSession(s)
                if (!d) continue
                counts.set(d, (counts.get(d) ?? 0) + 1)
            }
        }

        const labels = days
        const data = labels.map((d) => counts.get(d) ?? 0)
        return { labels, data }
    }, [sessions, flowsData, days])

    const sparkRef = useRef<any>(null)

    // Count sessions/flows in current slider range (by ms value)
    const inRangeCount = useMemo(() => {
        const [a, b] = value
        let count = 0

        if (flowsData) {
            // Count flows when flowsData is provided
            for (const flow of flowsData) {
                const t = Date.parse(flow.timestamp)
                if (Number.isNaN(t)) continue
                if (t >= a && t <= b) count += 1
            }
        } else {
            // Count sessions when flowsData is not provided
            for (const s of sessions) {
                const iso = (s as any).created_at || s.tool_calls?.[0]?.timestamp
                if (!iso) continue
                const t = Date.parse(String(iso))
                if (Number.isNaN(t)) continue
                if (t >= a && t <= b) count += 1
            }
        }
        return count
    }, [value, sessions, flowsData])

    // Count AI flows in current slider range (only when flowsData is provided)
    const inRangeAICount = useMemo(() => {
        if (!flowsData) return 0
        const [a, b] = value
        let count = 0
        for (const flow of flowsData) {
            const t = Date.parse(flow.timestamp)
            if (Number.isNaN(t)) continue
            if (t >= a && t <= b && flow.is_ai_provider === 1) count += 1
        }
        return count
    }, [value, flowsData])

    const selectionDurationMs = useMemo(() => {
        const [a, b] = value
        return Math.max(0, b - a)
    }, [value])

    const selectionDurationLabel = useMemo(() => {
        const ms = selectionDurationMs
        let seconds = Math.floor(ms / 1000)
        const days = Math.floor(seconds / 86400)
        seconds -= days * 86400
        const hours = Math.floor(seconds / 3600)
        seconds -= hours * 3600
        const minutes = Math.floor(seconds / 60)
        seconds -= minutes * 60
        if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`
        if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
        if (minutes > 0) return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}`
        return `${seconds}s`
    }, [selectionDurationMs])

    // Reflect external hoverDay to sparkline active tooltip
    useEffect(() => {
        try {
            const chart = sparkRef.current
            if (!chart) return
            if (!hoverTimeLabel) {
                chart.setActiveElements([])
                chart.update()
                return
            }
            const idx = days.indexOf(hoverTimeLabel)
            if (idx >= 0) {
                chart.setActiveElements([{ datasetIndex: 0, index: idx }])
                chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 })
                chart.update()
            }
        } catch { /* noop */ }
    }, [hoverTimeLabel, days])

    // Listen for global chart hover events to sync crosshair
    useEffect(() => {
        const onHover = (e: any) => {
            try {
                const idx = Number(e?.detail?.index)
                if (!Number.isFinite(idx)) return
                const chart = sparkRef.current
                if (!chart) return
                chart.setActiveElements([{ datasetIndex: 0, index: idx }])
                chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 })
                chart.update()
            } catch { /* noop */ }
        }
        const onLeave = () => {
            try {
                const chart = sparkRef.current
                if (!chart) return
                chart.setActiveElements([])
                chart.update()
            } catch { /* noop */ }
        }
        window.addEventListener('chart-hover', onHover as any)
        window.addEventListener('chart-hover-leave', onLeave as any)
        return () => {
            window.removeEventListener('chart-hover', onHover as any)
            window.removeEventListener('chart-hover-leave', onLeave as any)
        }
    }, [])

    if (days.length === 0) return null

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs text-app-muted">
                    <div>Date range (drag handles or bar)</div>
                    {flowsData ? (
                        <>
                            <span className="badge">{inRangeCount} flows</span>
                            <span className="badge">{inRangeAICount} AI flows</span>
                        </>
                    ) : (
                        <span className="badge">{inRangeCount} {itemLabel}</span>
                    )}
                    <span className="badge">{selectionDurationLabel}</span>
                </div>
                <div className="relative">
                    <button className="badge" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => setOpen(v => !v)}>Quick ranges</button>
                    {open && (
                        <div className="absolute right-0 mt-1 w-44 border rounded shadow-md z-10 p-1" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                            {(() => {
                                const haveDays = days.length > 0
                                const maxDay = haveDays ? days[days.length - 1]! : ''
                                const todayIso = new Date().toISOString().slice(0, 10)
                                const lastNDays = (n: number) => {
                                    const d = new Date(); d.setDate(d.getDate() - (n - 1)); return d.toISOString().slice(0, 10)
                                }
                                // quick helpers removed; live ranges use activateLive()
                                const clampStart = (iso: string) => {
                                    if (!haveDays) return ''
                                    for (const d of days) { if (d >= iso) return d }
                                    return days[0]!
                                }
                                const activateLive = (windowMs: number) => {
                                    const now = Date.now() // Always use current time, not stale nowMs
                                    const a = now - windowMs
                                    const b = now
                                    // Don't set up live window - just set a static range
                                    setLiveWindowMs(null)
                                    const newValue = [a, b] as [number, number]
                                    setValue(newValue)
                                    onExternalChange?.(newValue) // Call external onChange for controlled components
                                    onTimeRangeMsChange?.(a, b)
                                    const sa = new Date(a).toISOString().slice(0, 10)
                                    const sb = new Date(b).toISOString().slice(0, 10)
                                    onTimeRangeChange(sa, sb)
                                    setOpen(false)
                                }
                                return (
                                    <div className="flex flex-col gap-1 text-xs">
                                        <button className="badge" onClick={() => activateLive(60_000)}>Last 1 min</button>
                                        <button className="badge" onClick={() => activateLive(5 * 60_000)}>Last 5 min</button>
                                        <button className="badge" onClick={() => activateLive(30 * 60_000)}>Last 30 min</button>
                                        <button className="badge" onClick={() => activateLive(60 * 60_000)}>Last 1 hour</button>
                                        <button className="badge" onClick={() => activateLive(6 * 60 * 60_000)}>Last 6 hours</button>
                                        <button className="badge" onClick={() => activateLive(24 * 60 * 60_000)}>Last 24 hours</button>
                                        <button className="badge" onClick={() => activateLive(7 * 24 * 60 * 60_000)}>Last 7 days</button>
                                        <button className="badge" onClick={() => activateLive(30 * 24 * 60 * 60_000)}>Last 30 days</button>
                                        <button className="badge" onClick={() => { setLiveWindowMs(null); const s = clampStart(todayIso); applyRange(s, maxDay || s) }}>Today</button>
                                        <button className="badge" onClick={() => { setLiveWindowMs(null); const s = clampStart(lastNDays(7)); applyRange(s, maxDay || s) }}>This week</button>
                                        <button className="badge" onClick={() => { setLiveWindowMs(null); const s = clampStart(lastNDays(30)); applyRange(s, maxDay || s) }}>This month</button>
                                        <button className="badge" onClick={() => { setLiveWindowMs(null); const s = clampStart(lastNDays(365)); applyRange(s, maxDay || s) }}>This year</button>
                                        <button className="badge" onClick={() => { setLiveWindowMs(null); if (haveDays) applyRange(days[0]!, maxDay || days[0]!) }}>All time</button>
                                    </div>
                                )
                            })()}
                        </div>
                    )}
                </div>
            </div>
            <div className="px-2">
                <div className="mb-3" style={{ height: 80, overflow: 'hidden' }}>
                    {histogram.labels.length > 0 ? (
                        <Line ref={sparkRef as any} height={60} data={{
                            labels: histogram.labels,
                            datasets: [{ label: flowsData ? 'flows' : 'sessions', data: histogram.data, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', tension: 0.3, pointRadius: 0 }],
                        }} options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                            interaction: { mode: 'index', intersect: false },
                            onHover: (_evt: any, elements: any[]) => {
                                try {
                                    const idx = elements?.[0]?.index
                                    if (typeof idx === 'number' && idx >= 0 && idx < histogram.labels.length) {
                                        const label = histogram.labels[idx]
                                        if (label) onHoverTimeChange?.(label)
                                    }
                                } catch { /* noop */ }
                            },
                            // @ts-expect-error allow custom callback property via plugin typing hole
                            onLeave: () => onHoverTimeChange?.(null),
                            scales: { x: { offset: false, bounds: 'ticks', alignToPixels: true, ticks: { color: '#a0a7b4', autoSkip: true, maxTicksLimit: 8, align: 'inner' as any, callback: (_v: any, i: number) => (i === 0 ? '' : undefined) as any } }, y: { ticks: { color: '#a0a7b4' } } },
                        }} />
                    ) : (
                        <div className="flex items-center justify-center h-full text-app-muted text-sm">
                            No data available
                        </div>
                    )}
                </div>
                <Slider
                    style={{ overflow: 'hidden' }}
                    range
                    min={minTs}
                    max={maxTs}
                    value={value}
                    draggableTrack
                    handleRender={(node: any, props: any) => {
                        const ms = Number(props?.value)
                        const label = Number.isFinite(ms) ? dayjs(ms).format('YYYY-MM-DD HH:mm') : ''
                        return (
                            <div style={{ position: 'relative' }}>
                                {node}
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: -24,
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        background: 'var(--border)',
                                        color: 'var(--text)',
                                        fontSize: 10,
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        whiteSpace: 'nowrap',
                                        pointerEvents: 'none',
                                    }}
                                >
                                    {label}
                                </div>
                            </div>
                        )
                    }}
                    onChange={(val: number | number[]) => {
                        const v = (Array.isArray(val) ? val : [minTs, minTs]) as [number, number]
                        // Just set the value directly without any constraints or snapping
                        setValue(v)
                        setIsManuallyDragging(true) // Mark as manually dragging

                        if (liveWindowMs != null) setLiveWindowMs(null)

                        // Call external onChange if provided
                        onExternalChange?.(v)

                        // Convert positions to timestamps and emit
                        const sa = new Date(v[0]).toISOString().slice(0, 10)
                        const sb = new Date(v[1]).toISOString().slice(0, 10)
                        onTimeRangeMsChange?.(v[0], v[1])
                        if (sa && sb) onTimeRangeChange(sa, sb)
                    }}
                    onAfterChange={(val: number | number[]) => {
                        const v = (Array.isArray(val) ? val : [minTs, minTs]) as [number, number]
                        // Just set the value directly without any constraints or snapping
                        setValue(v)
                        setIsManuallyDragging(false) // Clear manual dragging flag

                        if (liveWindowMs != null) setLiveWindowMs(null)

                        // Call external onChange if provided
                        onExternalChange?.(v)

                        // Convert positions to timestamps and emit
                        const sa = new Date(v[0]).toISOString().slice(0, 10)
                        const sb = new Date(v[1]).toISOString().slice(0, 10)
                        onTimeRangeMsChange?.(v[0], v[1])
                        if (sa && sb) onTimeRangeChange(sa, sb)
                    }}
                    allowCross={true}
                    step={1000}
                    marks={marks}
                    pushable={false}
                />
            </div>
        </div>
    )
}

export default DateRangeSlider


