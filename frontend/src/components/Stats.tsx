import { useMemo } from 'react'
import type { Session } from '../types'
import { Line, Bar } from 'react-chartjs-2'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    LogarithmicScale,
    PointElement,
    LineElement,
    BarElement,
    Tooltip,
    Legend,
    Decimation,
} from 'chart.js'

// Register base elements and a tiny crosshair plugin for vertical guideline
ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, BarElement, Tooltip, Legend, Decimation)

const CrosshairPlugin = {
    id: 'crosshair',
    afterDatasetsDraw(chart: any, _args: unknown, opts: any) {
        const active = chart?.tooltip?.getActiveElements?.() || []
        if (!active.length) return
        const x = active[0]?.element?.x
        if (typeof x !== 'number') return
        const { top, bottom } = chart.chartArea
        const ctx = chart.ctx
        ctx.save()
        ctx.strokeStyle = (opts && opts.color) || '#6b7280'
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, bottom)
        ctx.stroke()
        ctx.restore()
    },
}
ChartJS.register(CrosshairPlugin as any)

const COLOR_PALETTE = [
    { fill: 'rgba(99,102,241,0.6)', stroke: 'rgba(99,102,241,1)' }, // indigo
    { fill: 'rgba(34,197,94,0.6)', stroke: 'rgba(34,197,94,1)' },  // green
    { fill: 'rgba(59,130,246,0.6)', stroke: 'rgba(59,130,246,1)' }, // blue
    { fill: 'rgba(244,114,182,0.6)', stroke: 'rgba(244,114,182,1)' }, // pink
    { fill: 'rgba(251,191,36,0.6)', stroke: 'rgba(251,191,36,1)' },  // amber
    { fill: 'rgba(248,113,113,0.6)', stroke: 'rgba(248,113,113,1)' }, // red
    { fill: 'rgba(14,165,233,0.6)', stroke: 'rgba(14,165,233,1)' },  // sky
    { fill: 'rgba(139,92,246,0.6)', stroke: 'rgba(139,92,246,1)' },  // violet
]

type Bucket = { label: string; value: number }

function groupByDayCalls(sessions: Session[]): Bucket[] {
    const map = new Map<string, number>()
    for (const s of sessions) {
        const iso = s.created_at || s.tool_calls[0]?.timestamp
        if (!iso) continue
        const day = new Date(iso).toISOString().slice(0, 10)
        map.set(day, (map.get(day) ?? 0) + s.tool_calls.length)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }))
}

function histogramTools(sessions: Session[]): Bucket[] {
    const map = new Map<string, number>()
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const key = String(tc.tool_name || 'unknown')
            map.set(key, (map.get(key) ?? 0) + 1)
        }
    }
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([label, value]) => ({ label, value }))
}

function histogramSessionLengthsBinned(sessions: Session[], targetBins: number = 8): Bucket[] {
    const lengths = sessions.map((s) => s.tool_calls.length).filter((n) => n > 0)
    if (lengths.length === 0) return []
    const minV = 1
    const maxV = Math.max(...lengths)
    if (maxV <= 2) {
        const map = new Map<number, number>()
        for (const n of lengths) map.set(n, (map.get(n) ?? 0) + 1)
        return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ label: String(k), value: v }))
    }
    const bins = Math.max(3, Math.min(targetBins, 12))
    const ratio = Math.pow(maxV / minV, 1 / bins)
    const edges: number[] = []
    for (let i = 0; i < bins; i += 1) {
        const prev = i === 0 ? minV : edges[i - 1]!
        edges.push(Math.max(prev + 1, Math.round(prev * ratio)))
    }
    const counts = new Array(edges.length).fill(0)
    for (const n of lengths) {
        let idx = edges.findIndex((e) => n <= e)
        if (idx < 0) idx = edges.length - 1
        counts[idx] = (counts[idx] ?? 0) + 1
    }
    // Trim empty bins at edges
    let start = 0; let end = counts.length - 1
    while (start <= end && counts[start] === 0) start += 1
    while (end >= start && counts[end] === 0) end -= 1
    const out: Bucket[] = []
    for (let i = start; i <= end; i += 1) {
        const lo = i === 0 ? 1 : edges[i - 1]! + 1
        const hi = edges[i]!
        out.push({ label: lo === hi ? String(lo) : `${lo}-${hi}`, value: counts[i]! })
    }
    return out
}

function histogramCallDurationsLinear(sessions: Session[], binMs: number = 1000): Bucket[] {
    const map = new Map<number, number>()
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (d == null) continue
            const bin = Math.floor(d / binMs)
            map.set(bin, (map.get(bin) ?? 0) + 1)
        }
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0])
    return entries.map(([bin, count]) => ({ label: `${(bin * binMs) / 1000}-${((bin + 1) * binMs) / 1000}s`, value: count }))
}

const fmtRange = (loSec: number, hiSec: number): string => {
    const fmt = (s: number) => (s < 1 ? `${Math.round(s * 1000)}ms` : `${Math.round(s)}s`)
    return `${fmt(loSec)}-${fmt(hiSec)}`
}

function histogramCallDurationsLogDynamic(sessions: Session[], targetBins: number = 10): Bucket[] {
    const vals: number[] = []
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const ms = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (ms != null) vals.push(ms / 1000)
        }
    }
    if (vals.length === 0) return []
    const minV = Math.max(0.001, Math.min(...vals)) // start at 1ms
    const maxV = Math.max(...vals)
    if (maxV <= minV) return [{ label: fmtRange(minV, maxV), value: vals.length }]
    const bins = Math.max(3, Math.min(targetBins, 20))
    const ratio = Math.pow(maxV / minV, 1 / bins)
    const edges: number[] = []
    for (let i = 0; i < bins; i += 1) {
        const prev = i === 0 ? minV : edges[i - 1]!
        edges.push(prev * ratio)
    }
    const counts = new Array(edges.length).fill(0)
    for (const v of vals) {
        let idx = edges.findIndex((e) => v <= e)
        if (idx < 0) idx = edges.length - 1
        counts[idx] = (counts[idx] ?? 0) + 1
    }
    // Trim empty outer bins
    let start = 0; let end = counts.length - 1
    while (start <= end && counts[start] === 0) start += 1
    while (end >= start && counts[end] === 0) end -= 1
    const out: Bucket[] = []
    let prev = minV
    for (let i = 0; i < edges.length; i += 1) {
        const hi = edges[i]!
        if (i >= start && i <= end) out.push({ label: fmtRange(prev, hi), value: counts[i]! })
        prev = hi
    }
    return out
}

function percentileCurve(sessions: Session[]): { xs: number[]; ys: number[] } {
    const arr: number[] = []
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (d != null) arr.push(d)
        }
    }
    if (arr.length === 0) return { xs: [], ys: [] }
    arr.sort((a, b) => a - b)
    const xs: number[] = []
    const ys: number[] = []
    for (let p = 0; p <= 100; p += 5) {
        const rank = (p / 100) * (arr.length - 1)
        const lo = Math.floor(rank)
        const hi = Math.ceil(rank)
        const loVal = arr[Math.max(0, Math.min(lo, arr.length - 1))] as number
        const hiVal = arr[Math.max(0, Math.min(hi, arr.length - 1))] as number
        const v = lo === hi ? loVal : loVal + (hiVal - loVal) * (rank - lo)
        xs.push(p)
        ys.push(v / 1000) // seconds
    }
    return { xs, ys }
}

function trifectaComboKey(summary: Record<string, unknown> | undefined): string {
    const s: any = summary || {}
    const t = s.lethal_trifecta || s.trifecta || {}
    const p = Boolean(t.has_private_data_access)
    const u = Boolean(t.has_untrusted_content_exposure)
    const e = Boolean(t.has_external_communication)
    return `${p ? 'P' : '-'}${u ? 'U' : '-'}${e ? 'E' : '-'}` // 8 combos: ---, P--, -U-, --E, PU-, P-E, -UE, PUE
}

function histogramTrifectaCombos(sessions: Session[]): Bucket[] {
    const combos = ['---', 'P--', '-U-', '--E', 'PU-', 'P-E', '-UE', 'PUE']
    const map = new Map<string, number>(combos.map((k) => [k, 0]))
    for (const s of sessions) {
        const key = trifectaComboKey(s.data_access_summary as any)
        map.set(key, (map.get(key) ?? 0) + 1)
    }
    return combos.map((label) => ({ label, value: map.get(label) ?? 0 }))
}

function SimpleBar({ data, maxLabel }: { data: Bucket[]; maxLabel?: number }) {
    const max = data.reduce((m, x) => Math.max(m, x.value), 1)
    const items = maxLabel ? data.slice(0, maxLabel) : data
    return (
        <div className="space-y-2">
            {items.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                    <div className="text-xs w-20 truncate" title={b.label}>{b.label}</div>
                    <div className="h-2 bg-app-border rounded flex-1 overflow-hidden">
                        <div className="h-2 bg-app-accent rounded" style={{ width: `${(b.value / max) * 100}%` }} />
                    </div>
                    <div className="text-xs text-app-muted" style={{ width: 28, textAlign: 'right' }}>{b.value}</div>
                </div>
            ))}
        </div>
    )
}

// Sparkline removed after switching to Chart.js line chart

export function Stats({ sessions }: { sessions: Session[] }) {
    const callsOverTime = useMemo(() => groupByDayCalls(sessions), [sessions])
    const toolsHist = useMemo(() => histogramTools(sessions), [sessions])
    const sessionLenHist = useMemo(() => histogramSessionLengthsBinned(sessions), [sessions])
    const durationHistLinear = useMemo(() => histogramCallDurationsLinear(sessions, 1000), [sessions])
    const durationHistLog = useMemo(() => histogramCallDurationsLogDynamic(sessions, 10), [sessions])
    const perc = useMemo(() => percentileCurve(sessions), [sessions])
    const trifectaHist = useMemo(() => histogramTrifectaCombos(sessions), [sessions])

    return (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Calls over time (by day)</div>
                <Line height={160} data={{
                    labels: callsOverTime.map(b => b.label),
                    datasets: [{
                        label: 'Calls',
                        data: callsOverTime.map(b => b.value),
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139,92,246,0.2)',
                        tension: 0.3,
                        pointRadius: 0,
                    }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { labels: { color: '#a0a7b4' } }, tooltip: { mode: 'index', intersect: false } },
                    animation: false,
                    elements: { line: { tension: 0.25 } },
                    scales: { x: { ticks: { color: '#a0a7b4' } }, y: { type: 'logarithmic', ticks: { color: '#a0a7b4' } } },
                }} />
            </div>
            {/* Row separator */}
            <div className="col-span-2 h-px bg-app-border opacity-60 my-1" />
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Top tools by calls</div>
                <Bar height={160} data={{
                    labels: toolsHist.map(b => b.label),
                    datasets: [{
                        label: 'calls',
                        data: toolsHist.map(b => b.value),
                        backgroundColor: toolsHist.map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length]!.fill),
                        borderColor: toolsHist.map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length]!.stroke),
                        borderWidth: 1,
                    }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    animation: false,
                    scales: { x: { ticks: { color: '#a0a7b4', autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false } }, y: { ticks: { color: '#a0a7b4' } } },
                }} />
            </div>
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Session length (calls per session)</div>
                <SimpleBar data={sessionLenHist} />
            </div>
            {/* Row separator */}
            <div className="col-span-2 h-px bg-app-border opacity-60 my-1" />
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Tool call durations (linear bins, s)</div>
                <SimpleBar data={durationHistLinear} />
            </div>
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Tool call durations (log bins)</div>
                <SimpleBar data={durationHistLog} />
            </div>
            {/* Row separator */}
            <div className="col-span-2 h-px bg-app-border opacity-60 my-1" />
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Duration percentile (p vs seconds)</div>
                <Line height={160} data={{
                    labels: perc.xs.map(x => `${x}%`),
                    datasets: [{ label: 'secs', data: perc.ys, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', tension: 0.25, pointRadius: 0 }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#a0a7b4' } } },
                    scales: { x: { ticks: { color: '#a0a7b4' } }, y: { ticks: { color: '#a0a7b4' } } },
                }} />
            </div>
            <div className="card" style={{ minHeight: '14rem', height: '14rem', minWidth: 0, overflow: 'hidden' }}>
                <div className="text-xs text-app-muted mb-2">Trifecta combinations</div>
                <div className="flex items-center gap-3 mb-2 text-xs">
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Private</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Untrusted</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> External</span>
                </div>
                <SimpleBar data={trifectaHist} />
                <div className="text-[10px] text-app-muted mt-2">Legend: P=Private, U=Untrusted, E=External</div>
            </div>
        </div>
    )
}

export default Stats


