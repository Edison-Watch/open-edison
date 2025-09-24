import { useMemo, useState } from 'react'
import type { Session } from '../types'
import { Line, Bar } from 'react-chartjs-2'
import Panel from './Panel'
import { format as d3format } from 'd3-format'
import dayjs from 'dayjs'
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
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 15)
    const rest = sorted.slice(15)
    const buckets = top.map(([label, value]) => ({ label, value }))
    if (rest.length > 0) {
        const other = rest.reduce((acc, [, v]) => acc + v, 0)
        if (other > 0) buckets.push({ label: 'Other', value: other })
    }
    return buckets
}

function serverNameFromToolName(toolName: string): string {
    if (!toolName) return 'unknown'
    if (toolName.startsWith('builtin_')) return 'builtin'
    if (toolName.startsWith('agent_')) return 'agent'
    const idx = toolName.indexOf('_')
    return idx > 0 ? toolName.slice(0, idx) : toolName
}

function histogramServers(sessions: Session[]): Bucket[] {
    const map = new Map<string, number>()
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const server = serverNameFromToolName(String(tc.tool_name || 'unknown'))
            map.set(server, (map.get(server) ?? 0) + 1)
        }
    }
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 15)
    const rest = sorted.slice(15)
    const buckets = top.map(([label, value]) => ({ label, value }))
    if (rest.length > 0) {
        const other = rest.reduce((acc, [, v]) => acc + v, 0)
        if (other > 0) buckets.push({ label: 'Other', value: other })
    }
    return buckets
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

// Removed linear bin histogram in favor of log-binned view only

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
    // Return as X = seconds, Y = percentile (0..100)
    const msArr: number[] = []
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (d != null) msArr.push(d)
        }
    }
    if (msArr.length === 0) return { xs: [], ys: [] }
    msArr.sort((a, b) => a - b)
    const xs: number[] = [] // seconds
    const ys: number[] = [] // percent
    // Sample x values across the range (sec)
    const minS = msArr[0]! / 1000
    const maxS = msArr[msArr.length - 1]! / 1000
    const steps = 20
    for (let i = 0; i <= steps; i += 1) {
        const sec = minS + ((maxS - minS) * i) / steps
        // Compute percentile for this duration
        const ms = sec * 1000
        let idx = msArr.findIndex((v) => v >= ms)
        if (idx < 0) idx = msArr.length - 1
        const pct = (idx / (msArr.length - 1)) * 100
        xs.push(sec)
        ys.push(pct)
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

// Removed SimpleBar (horizontal bars) in favor of vertical Bar charts

// Sparkline removed after switching to Chart.js line chart

export function Stats({ sessions }: { sessions: Session[] }) {
    const callsOverTime = useMemo(() => groupByDayCalls(sessions), [sessions])
    const toolsHist = useMemo(() => histogramTools(sessions), [sessions])
    const serversHist = useMemo(() => histogramServers(sessions), [sessions])
    const sessionLenHist = useMemo(() => histogramSessionLengthsBinned(sessions), [sessions])
    const durationHistLog = useMemo(() => histogramCallDurationsLogDynamic(sessions, 10), [sessions])
    const perc = useMemo(() => percentileCurve(sessions), [sessions])
    const trifectaHist = useMemo(() => histogramTrifectaCombos(sessions), [sessions])

    // Formatters
    const fmtSI = useMemo(() => d3format('~s'), [])
    const fmtDate = (d: string) => dayjs(d).format('MM-DD')
    const fmtSecs = (s: number) => (s < 1 ? `${Math.round(s * 1000)}ms` : `${Math.round(s * 10) / 10}s`)

    // Calls chart controls
    const [callsScale, setCallsScale] = useState<'linear' | 'logarithmic'>('linear')
    const [showMA, setShowMA] = useState<boolean>(true)
    const [topBy, setTopBy] = useState<'tool' | 'server'>('tool')

    const callsLabels = useMemo(() => callsOverTime.map(b => b.label), [callsOverTime])
    const callsValues = useMemo(() => callsOverTime.map(b => b.value), [callsOverTime])
    const callsMA = useMemo(() => {
        const w = 7
        const out: number[] = []
        for (let i = 0; i < callsValues.length; i += 1) {
            const a = Math.max(0, i - (w - 1))
            const slice = callsValues.slice(a, i + 1)
            const sum = slice.reduce((acc, v) => acc + v, 0)
            out.push(sum / slice.length)
        }
        return out
    }, [callsValues])

    // Percentiles for captions
    const durationSeconds = useMemo(() => {
        const arr: number[] = []
        for (const s of sessions) {
            for (const tc of s.tool_calls) {
                const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
                if (d != null) arr.push(d / 1000)
            }
        }
        return arr.sort((a, b) => a - b)
    }, [sessions])
    const pct = useMemo(() => {
        const get = (p: number) => {
            if (durationSeconds.length === 0) return 0
            const rank = (p / 100) * (durationSeconds.length - 1)
            const lo = Math.floor(rank)
            const hi = Math.ceil(rank)
            const loVal = durationSeconds[Math.max(0, Math.min(lo, durationSeconds.length - 1))] as number
            const hiVal = durationSeconds[Math.max(0, Math.min(hi, durationSeconds.length - 1))] as number
            return lo === hi ? loVal : loVal + (hiVal - loVal) * (rank - lo)
        }
        return { p50: get(50), p90: get(90), p95: get(95) }
    }, [durationSeconds])

    return (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Panel title="Calls over time (by day)" unit="calls">
                <div className="flex items-center gap-2 mb-1 text-[10px]">
                    <button className={`badge ${callsScale === 'linear' ? 'bg-app-accent/10 text-app-accent' : ''}`} onClick={() => setCallsScale('linear')}>Linear</button>
                    <button className={`badge ${callsScale === 'logarithmic' ? 'bg-app-accent/10 text-app-accent' : ''}`} onClick={() => setCallsScale('logarithmic')}>Log</button>
                    <button className={`badge ${showMA ? 'bg-app-accent/10 text-app-accent' : ''}`} onClick={() => setShowMA((prev) => !prev)}>7-day Moving Average</button>
                </div>
                <Line height={140} data={{
                    labels: callsLabels,
                    datasets: [
                        {
                            label: 'Calls',
                            data: callsValues,
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139,92,246,0.2)',
                            tension: 0.25,
                            pointRadius: 0,
                        },
                        ...(showMA ? [{ label: '7-day Moving Average', data: callsMA, borderColor: '#34d399', backgroundColor: 'rgba(16,185,129,0.0)', borderDash: [6, 4], tension: 0, pointRadius: 0 }] : []),
                    ],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { labels: { color: '#a0a7b4' } }, tooltip: { mode: 'index', intersect: false }, decimation: { enabled: true, algorithm: 'min-max' } as any },
                    animation: false,
                    scales: {
                        x: { ticks: { color: '#a0a7b4', callback: (v: string | number) => fmtDate(String(v)), maxTicksLimit: 8 }, grid: { color: 'rgba(160,167,180,0.15)' } },
                        y: { type: callsScale, ticks: { color: '#a0a7b4', callback: (val: any) => fmtSI(Number(val)) }, grid: { color: 'rgba(160,167,180,0.15)' } },
                    },
                }} />
            </Panel>

            <Panel title={`Top ${topBy === 'tool' ? 'tools' : 'servers'} by calls`} unit="calls">
                <div className="flex items-center gap-2 mb-1 text-[10px]">
                    <button className={`badge ${topBy === 'tool' ? 'bg-app-accent/10 text-app-accent' : ''}`} onClick={() => setTopBy('tool')}>Tool</button>
                    <button className={`badge ${topBy === 'server' ? 'bg-app-accent/10 text-app-accent' : ''}`} onClick={() => setTopBy('server')}>Server</button>
                </div>
                <Bar height={160} data={{
                    labels: (topBy === 'tool' ? toolsHist : serversHist).map(b => b.label),
                    datasets: [{
                        label: 'calls',
                        data: (topBy === 'tool' ? toolsHist : serversHist).map(b => b.value),
                        backgroundColor: (topBy === 'tool' ? toolsHist : serversHist).map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length]!.fill),
                        borderColor: (topBy === 'tool' ? toolsHist : serversHist).map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length]!.stroke),
                        borderWidth: 1,
                    }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    animation: false,
                    scales: { x: { ticks: { color: '#a0a7b4', autoSkip: false, maxRotation: 45, minRotation: 45 }, grid: { display: false } }, y: { type: 'logarithmic', ticks: { color: '#a0a7b4', callback: (v: any) => fmtSI(Number(v)) } } },
                }} />
            </Panel>

            <Panel title="Session length" subtitle="Calls per session" unit="sessions">
                <Bar height={160} data={{
                    labels: sessionLenHist.map(b => b.label),
                    datasets: [{ label: 'sessions', data: sessionLenHist.map(b => b.value), backgroundColor: '#8b5cf6', borderColor: '#7c3aed' }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    animation: false,
                    scales: { x: { ticks: { color: '#a0a7b4', autoSkip: true, maxRotation: 0, minRotation: 0 } }, y: { ticks: { color: '#a0a7b4' } } },
                }} />
            </Panel>



            <Panel title="Tool call durations" subtitle="Log bins" unit="s">
                <Bar height={160} data={{
                    labels: durationHistLog.map(b => b.label),
                    datasets: [{ label: 'calls', data: durationHistLog.map(b => b.value), backgroundColor: '#34d399', borderColor: '#059669' }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    animation: false,
                    scales: { x: { ticks: { color: '#a0a7b4', autoSkip: true, maxRotation: 0, minRotation: 0 } }, y: { ticks: { color: '#a0a7b4' } } },
                }} />
                <div className="text-[10px] text-app-muted mt-2">p50 {fmtSecs(pct.p50)}, p90 {fmtSecs(pct.p90)}, p95 {fmtSecs(pct.p95)}</div>
            </Panel>

            <Panel title="Duration CDF" subtitle="Percent vs seconds" unit="%">
                <Line height={160} data={{
                    labels: perc.xs.map(x => fmtSecs(x)),
                    datasets: [{ label: 'percent', data: perc.ys.map(v => Math.max(0, Math.min(100, v))), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.2)', tension: 0, stepped: true, pointRadius: 0 }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#a0a7b4' } } },
                    scales: {
                        x: { ticks: { color: '#a0a7b4' }, title: { display: true, text: 'Seconds' } },
                        y: { ticks: { color: '#a0a7b4', callback: (v: any) => `${v}%` }, title: { display: true, text: 'Percent' }, min: 0, max: 100 },
                    },
                }} />
                <div className="text-[10px] text-app-muted mt-1">p50 {fmtSecs(pct.p50)}, p90 {fmtSecs(pct.p90)}, p95 {fmtSecs(pct.p95)}</div>
            </Panel>

            <Panel title="Trifecta combinations" subtitle="P/ U/ E flags" unit="sessions">
                <div className="flex items-center gap-3 mb-2 text-xs">
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Private</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Untrusted</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> External</span>
                </div>
                <Bar height={160} data={{
                    labels: trifectaHist.map(b => b.label),
                    datasets: [{ label: 'sessions', data: trifectaHist.map(b => b.value), backgroundColor: '#f59e0b', borderColor: '#d97706' }],
                }} options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    animation: false,
                    scales: { x: { ticks: { color: '#a0a7b4', autoSkip: false, maxRotation: 0, minRotation: 0 } }, y: { ticks: { color: '#a0a7b4' } } },
                }} />
                <div className="text-[10px] text-app-muted mt-2">Legend: P=Private, U=Untrusted, E=External</div>
            </Panel>
        </div>
    )
}

export default Stats


