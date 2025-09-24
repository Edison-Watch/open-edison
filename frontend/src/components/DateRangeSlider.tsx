import { useEffect, useMemo, useRef, useState } from 'react'
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
    startDay,
    endDay,
    onChange,
}: {
    sessions: (Session & { day?: string })[]
    startDay: string
    endDay: string
    onChange: (start: string, end: string) => void
}) {
    const days = useMemo(() => {
        const set = new Set<string>()
        for (const s of sessions) {
            const day = (s as any).day || dayFromSession(s)
            if (day) set.add(day)
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [sessions])

    const [value, setValue] = useState<[number, number]>(() => [0, Math.max(0, days.length - 1)])
    const rafRef = useRef<number | null>(null)
    const latestDaysRef = useRef<string[]>(days)
    useEffect(() => { latestDaysRef.current = days }, [days])

    // Sync external start/end to slider indices
    useEffect(() => {
        if (!days.length) return
        const si = Math.max(0, days.indexOf(startDay || days[0]!))
        const ei = Math.max(0, days.indexOf(endDay || days[days.length - 1]!))
        if (si !== value[0] || ei !== value[1]) setValue([Math.min(si, ei), Math.max(si, ei)])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDay, endDay, days.join(',')])

    const marks = useMemo(() => {
        const out: Record<number, string> = {}
        if (!days.length) return out
        const maxLabels = 12
        const step = Math.max(1, Math.ceil(days.length / maxLabels))
        for (let i = 0; i < days.length; i += step) {
            out[i] = days[i]!.slice(5)
        }
        out[days.length - 1] = days[days.length - 1]!.slice(5)
        return out
    }, [days])

    // Histogram of sessions per day for inline context
    const histogram = useMemo(() => {
        const counts = new Map<string, number>()
        for (const s of sessions) {
            const d = (s as any).day || dayFromSession(s)
            if (!d) continue
            counts.set(d, (counts.get(d) ?? 0) + 1)
        }
        const labels = days
        const data = labels.map((d) => counts.get(d) ?? 0)
        return { labels, data }
    }, [sessions, days])

    if (days.length === 0) return null

    return (
        <div className="card">
            <div className="text-xs text-app-muted mb-2">Date range (drag handles or bar)</div>
            <div className="px-2">
                <div className="mb-3" style={{ height: 80 }}>
                    <Line height={60} data={{
                        labels: histogram.labels,
                        datasets: [{ label: 'sessions', data: histogram.data, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.2)', tension: 0.3, pointRadius: 0 }],
                    }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#a0a7b4', autoSkip: true, maxTicksLimit: 8 } }, y: { ticks: { color: '#a0a7b4' } } } }} />
                </div>
                <Slider
                    range
                    min={0}
                    max={days.length - 1}
                    value={value}
                    draggableTrack
                    onChange={(val: number | number[]) => {
                        const v = (Array.isArray(val) ? val : [0, 0]) as [number, number]
                        const next: [number, number] = [Math.min(v[0], v[1]), Math.max(v[0], v[1])]
                        setValue(next)
                        // Live update parent (throttled to animation frame) for smooth sliding
                        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
                        rafRef.current = requestAnimationFrame(() => {
                            const d = latestDaysRef.current
                            const sa = d[next[0]] || d[0] || ''
                            const sb = d[next[1]] || d[d.length - 1] || sa
                            if (sa && sb) onChange(sa, sb)
                        })
                    }}
                    onAfterChange={(val: number | number[]) => {
                        const v = (Array.isArray(val) ? val : [0, 0]) as [number, number]
                        const a = Math.min(v[0], v[1])
                        const b = Math.max(v[0], v[1])
                        const sa = days[a] || days[0] || ''
                        const sb = days[b] || days[days.length - 1] || sa
                        if (sa && sb) onChange(sa, sb)
                    }}
                    allowCross={false}
                    step={1}
                    marks={marks}
                    pushable={false}
                />
            </div>
        </div>
    )
}

export default DateRangeSlider


