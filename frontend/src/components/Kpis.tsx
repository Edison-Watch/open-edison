import React, { useMemo } from 'react'
import type { Session } from '../types'
import { Line } from 'react-chartjs-2'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip)

function callsPerHour(sessions: Session[]): number[] {
    const map = new Map<string, number>()
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const iso = String((tc as any)?.timestamp || '')
            if (!iso) continue
            const d = new Date(iso)
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            const h = String(d.getHours()).padStart(2, '0')
            const key = `${y}-${m}-${day}T${h}`
            map.set(key, (map.get(key) ?? 0) + 1)
        }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([_, v]) => v)
}

function computeP95Ms(sessions: Session[]): number {
    const arr: number[] = []
    for (const s of sessions) {
        for (const tc of s.tool_calls) {
            const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (d != null) arr.push(d)
        }
    }
    if (arr.length === 0) return 0
    arr.sort((a, b) => a - b)
    const rank = 0.95 * (arr.length - 1)
    const lo = Math.floor(rank)
    const hi = Math.ceil(rank)
    const loVal = arr[Math.max(0, Math.min(lo, arr.length - 1))] as number
    const hiVal = arr[Math.max(0, Math.min(hi, arr.length - 1))] as number
    return lo === hi ? loVal : loVal + (hiVal - loVal) * (rank - lo)
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
    if (n >= 1_000) return `${Math.round(n / 100) / 10}k`
    return String(n)
}

export default function Kpis({ sessions, prevSessions }: { sessions: Session[]; prevSessions?: Session[] }) {
    const sessionsCount = sessions.length
    const callsCount = useMemo(() => sessions.reduce((acc, s) => acc + s.tool_calls.length, 0), [sessions])
    const errorCalls = useMemo(() => sessions.reduce((acc, s) => acc + s.tool_calls.filter(tc => tc.status === 'error').length, 0), [sessions])
    const errorRate = callsCount > 0 ? (errorCalls / callsCount) : 0
    const p95ms = useMemo(() => computeP95Ms(sessions), [sessions])

    const prevSessionsCount = prevSessions?.length ?? 0
    const prevCallsCount = useMemo(() => (prevSessions ?? []).reduce((acc, s) => acc + s.tool_calls.length, 0), [prevSessions])
    const prevErrorCalls = useMemo(() => (prevSessions ?? []).reduce((acc, s) => acc + s.tool_calls.filter(tc => tc.status === 'error').length, 0), [prevSessions])
    const prevErrorRate = prevCallsCount > 0 ? (prevErrorCalls / prevCallsCount) : 0
    const prevP95ms = useMemo(() => computeP95Ms(prevSessions ?? []), [prevSessions])

    const callsSpark = useMemo(() => callsPerHour(sessions), [sessions])

    function deltaText(
        curr: number,
        prev: number,
        opts?: { pct?: boolean; invertGood?: boolean }
    ): { text: string; pos: boolean; zero: boolean } {
        const d = curr - prev
        const val = opts?.pct ? Math.round(d * 1000) / 10 : Math.round(d)
        const zero = val === 0
        const improvement = opts?.invertGood ? val < 0 : val > 0
        const sign = val > 0 ? '+' : ''
        return { text: `${sign}${opts?.pct ? `${val}%` : `${val}`}`, pos: improvement, zero }
    }

    const dSessions = deltaText(sessionsCount, prevSessionsCount)
    const dCalls = deltaText(callsCount, prevCallsCount)
    const dErr = deltaText(errorRate * 100, prevErrorRate * 100, { pct: true, invertGood: true })
    const dP95 = deltaText(p95ms, prevP95ms, { invertGood: true })

    const Spark = ({ data, color }: { data: number[]; color: string }) => (
        <Line height={36} data={{
            labels: data.map((_, i) => String(i)),
            datasets: [{ label: 'spark', data, borderColor: color, backgroundColor: 'transparent', tension: 0.25, pointRadius: 0 }],
        }} options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } },
        }} />
    )

    const Item = ({ title, value, delta, deltaPos, deltaZero, unit, spark }: { title: string; value: string; delta: string; deltaPos: boolean; deltaZero?: boolean; unit?: string; spark?: React.ReactNode }) => (
        <div className="card" style={{ minHeight: 80 }}>
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs text-app-muted">{title}</div>
                    <div className="text-xl font-bold">{value}{unit ? <span className="text-xs text-app-muted ml-1">{unit}</span> : null}</div>
                    <div className={`text-xs ${deltaZero ? 'text-app-muted' : (deltaPos ? 'text-green-400' : 'text-red-400')}`}>{delta} vs prev</div>
                </div>
                <div style={{ width: 120, height: 40 }}>
                    {spark}
                </div>
            </div>
        </div>
    )

    return (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <Item title="Sessions" value={formatNumber(sessionsCount)} delta={dSessions.text} deltaPos={dSessions.pos} deltaZero={dSessions.zero} spark={<Spark data={callsSpark} color="#8b5cf6" />} />
            <Item title="Calls" value={formatNumber(callsCount)} delta={dCalls.text} deltaPos={dCalls.pos} deltaZero={dCalls.zero} spark={<Spark data={callsSpark} color="#34d399" />} />
            <Item title="Error rate" value={`${Math.round(errorRate * 1000) / 10}%`} delta={dErr.text} deltaPos={dErr.pos} deltaZero={dErr.zero} />
            <Item title="p95 duration" value={`${Math.round(p95ms)}`} unit="ms" delta={dP95.text} deltaPos={dP95.pos} deltaZero={dP95.zero} />
        </div>
    )
}



