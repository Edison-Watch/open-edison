import React from 'react'
import type { Session } from '../types'

type AclLevel = 'PUBLIC' | 'PRIVATE' | 'SECRET'
type PolicyOutcome = 'allow' | 'redact' | 'block' | 'governed'
type NodeType = 'service' | 'datastore' | 'security' | 'external' | 'agent' | 'observability' | 'policy'

type Health = 'healthy' | 'warning' | 'critical'

type NodeMeta = Record<string, string | number>

type NodeDatum = {
    id: string
    label: string
    type: NodeType
    x: number
    y: number
    width?: number
    height?: number
    health: Health
    acl?: AclLevel
    badges?: string[]
    meta: NodeMeta
}

type RecentCall = { t: string; d?: number; s?: string }

type EdgeDatum = {
    id: string
    from: string
    to: string
    kind: string
    volumePerHour: number
    outcome: PolicyOutcome
    aclMax: AclLevel
    policyName?: string
    needsApproval?: boolean
    simulated?: boolean
    escalated?: boolean
    risk?: {
        trifecta?: number
        jailbreak?: number
        blocks?: number
    }
    latencyMsP95?: number
    errorRate?: number
    recent?: RecentCall[]
}

const ACL_COLORS: Record<AclLevel, string> = {
    PUBLIC: 'rgba(34,157,94,0.86)',
    PRIVATE: 'rgba(205,158,11,0.86)',
    SECRET: 'rgba(209,68,68,0.86)',
}

const OUTCOME_COLORS: Record<PolicyOutcome, string> = {
    allow: '#22c55e',
    redact: '#f59e0b',
    block: '#ef4444',
    governed: '#60a5fa',
}

function volumeToWidth(volumePerHour: number): number {
    const v = Math.min(2000, Math.max(0, volumePerHour))
    return 1 + (v / 2000) * 5
}

function p95(values: number[]): number | undefined {
    if (!values.length) return undefined
    const arr = [...values].sort((a, b) => a - b)
    const idx = Math.floor(0.95 * (arr.length - 1))
    return arr[idx]
}

function nodeFill(n: NodeDatum): string {
    // Pick a palette based on current theme (document <html data-theme>)
    let theme: 'dark' | 'light' = 'dark'
    try {
        const t = document.documentElement.getAttribute('data-theme')
        theme = (t === 'light') ? 'light' : 'dark'
    } catch { /* noop */ }

    // Health overrides take precedence
    if (n.health === 'critical') return theme === 'dark' ? '#3a0d0d' : '#fee2e2'
    if (n.health === 'warning') return theme === 'dark' ? '#382e0b' : '#fef3c7'

    if (n.type === 'agent') return theme === 'dark' ? '#2b1b3d' : '#f3e8ff'
    if (n.type === 'observability') return theme === 'dark' ? '#15324a' : '#e0f2fe'
    if (n.type === 'policy') return theme === 'dark' ? '#2a2438' : '#ede9fe'
    if (n.type === 'external') return theme === 'dark' ? '#143326' : '#dcfce7'
    return 'var(--card)'
}

function strokeForOutcome(o: PolicyOutcome): string {
    return OUTCOME_COLORS[o]
}

function getNodeSize(n: NodeDatum): { w: number; h: number } {
    const base = { w: 180, h: 64 }
    if (n.type === 'external') return { w: 180, h: 60 }
    if (n.type === 'security') return { w: 190, h: 68 }
    if (n.type === 'policy') return { w: 190, h: 68 }
    return { w: n.width || base.w, h: n.height || base.h }
}

function Hexagon({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    const cx = x + w / 2
    const cy = y + h / 2
    const dx = w / 2
    // h/2 kept implicit for hexagon vertical radius; no direct variable use
    const points = [
        [cx - dx * 0.6, y],
        [cx + dx * 0.6, y],
        [x + w, cy],
        [cx + dx * 0.6, y + h],
        [cx - dx * 0.6, y + h],
        [x, cy],
    ]
        .map((p) => p.join(','))
        .join(' ')
    return (
        <g filter="url(#nodeShadow)">
            <polygon points={points} fill={fill} stroke={stroke} />
            <polygon points={points} fill="url(#nodeGloss)" stroke="none" pointerEvents="none" />
        </g>
    )
}

function Cylinder({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    const rx = w / 2
    const ry = Math.max(8, Math.min(16, h / 6))
    return (
        <g filter="url(#nodeShadow)">
            <rect x={x} y={y + ry / 2} width={w} height={h - ry} rx={12} ry={12} fill={fill} stroke={stroke} />
            <ellipse cx={x + rx} cy={y + ry / 2} rx={rx} ry={ry} fill={fill} stroke={stroke} />
            <ellipse cx={x + rx} cy={y + h - ry / 2} rx={rx} ry={ry} fill={fill} stroke={stroke} />
            <rect x={x} y={y + ry / 2} width={w} height={Math.max(8, (h - ry) * 0.5)} rx={12} ry={12} fill="url(#nodeGloss)" stroke="none" pointerEvents="none" />
        </g>
    )
}

function Pill({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    const r = Math.min(h / 2, 24)
    return (
        <g filter="url(#nodeShadow)">
            <rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill={fill} stroke={stroke} />
            <rect x={x} y={y} width={w} height={h * 0.55} rx={r} ry={r} fill="url(#nodeGloss)" stroke="none" pointerEvents="none" />
        </g>
    )
}

function Rounded({ x, y, w, h, fill, stroke }: { x: number; y: number; w: number; h: number; fill: string; stroke: string }) {
    return (
        <g filter="url(#nodeShadow)">
            <rect x={x} y={y} width={w} height={h} rx={12} ry={12} fill={fill} stroke={stroke} />
            <rect x={x} y={y} width={w} height={h * 0.55} rx={12} ry={12} fill="url(#nodeGloss)" stroke="none" pointerEvents="none" />
        </g>
    )
}

function formatRatePerHour(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k/h`
    if (n >= 10) return `${Math.round(n)}/h`
    if (n >= 1) return `${n.toFixed(1)}/h`
    return `${n.toFixed(2)}/h`
}

// Time window is derived from provided sessions; no internal selector

const AGENT_TOOL_ACL: Record<string, AclLevel> = {
    agent_web_search: 'SECRET',
    agent_fetch_url: 'SECRET',
    agent_http_head: 'SECRET',
    agent_summarize: 'PUBLIC',
    agent_regex_extract: 'PUBLIC',
    agent_token_count: 'PUBLIC',
    agent_add: 'PUBLIC',
    agent_multiply: 'PUBLIC',
    agent_random_int: 'PUBLIC',
    agent_now_iso: 'PUBLIC',
    agent_sleep_ms: 'PUBLIC',
    agent_list_top: 'PUBLIC',
    agent_dict_keys: 'PUBLIC',
}

function computeGraphFromSessions(sessions: Session[], window?: { start?: number; end?: number }): { nodes: NodeDatum[]; edges: EdgeDatum[] } {
    const nodes: NodeDatum[] = []
    const edges: EdgeDatum[] = []
    // Determine span across agent calls to normalize per-hour rates
    let minTs = Number.POSITIVE_INFINITY
    let maxTs = 0

    // We will add anchors only if there is activity
    let agentNode: NodeDatum | null = null
    let llmAgent: NodeDatum | null = null
    let policyNode: NodeDatum | null = null
    let externalNode: NodeDatum | null = null
    let obsNode: NodeDatum | null = null
    let auditNode: NodeDatum | null = null

    // Metrics per tool
    type Acc = { count: number; errors: number; durations: number[]; blocked: number; needsApproval: boolean; escalated: boolean; recent: RecentCall[] }
    const byTool = new Map<string, Acc>()
    let sessionsInWindow = 0
    let totalAgentCalls = 0
    for (const s of sessions) {
        const calls = s.tool_calls.filter(tc => tc.tool_name && String(tc.tool_name).startsWith('agent_') && tc.timestamp)
        if (calls.length > 0) sessionsInWindow += 1
        for (const tc of calls) {
            const name = String(tc.tool_name)
            const acc = byTool.get(name) || { count: 0, errors: 0, durations: [], blocked: 0, needsApproval: false, escalated: false, recent: [] }
            // If ms window provided, skip calls outside
            const t = String(tc.timestamp)
            const tNum = Date.parse(t)
            const inRange = !window || (
                (typeof window.start !== 'number' || (!Number.isNaN(tNum) && tNum >= window.start)) &&
                (typeof window.end !== 'number' || (!Number.isNaN(tNum) && tNum <= window.end))
            )
            if (!inRange) continue
            acc.count += 1
            totalAgentCalls += 1
            if (tc.status === 'error') acc.errors += 1
            if (tc.status === 'blocked') acc.blocked += 1
            const d = typeof tc.duration_ms === 'number' ? Math.max(0, tc.duration_ms) : null
            if (d != null) acc.durations.push(d)
            const tNum2 = Date.parse(t)
            if (!Number.isNaN(tNum2)) {
                if (tNum2 < minTs) minTs = tNum2
                if (tNum2 > maxTs) maxTs = tNum2
            }
            acc.recent.push({ t, d: d ?? undefined, s: typeof tc.status === 'string' ? tc.status : undefined })
            byTool.set(name, acc)
        }
    }
    const windowHours = (() => {
        if (!Number.isFinite(minTs) || maxTs <= minTs) return 1
        const h = (maxTs - minTs) / 3_600_000
        return Math.max(1, h)
    })()
    // If no calls in range, return empty graph
    if (totalAgentCalls === 0) {
        return { nodes: [], edges: [] }
    }

    // Static anchors now that we know we have data
    agentNode = { id: 'openedison', label: 'OpenEdison (MCP Proxy)', type: 'agent', x: 420, y: 200, health: 'healthy', meta: { sessions: sessionsInWindow }, acl: 'SECRET', badges: ['ACL: SECRET'] }
    llmAgent = { id: 'demoagent', label: 'Demo Agent', type: 'service', x: agentNode.x - 240, y: agentNode.y, health: 'healthy', meta: {}, badges: ['LangGraph'] }
    policyNode = { id: 'policy', label: 'Policy Registry (PAAC)', type: 'policy', x: 420, y: 420, health: 'healthy', meta: { rules: 0 }, badges: ['Active'] }
    externalNode = { id: 'external', label: 'External Web', type: 'external', x: 860, y: 220, health: 'healthy', meta: {}, badges: ['Residency: US'] }
    obsNode = { id: 'obs', label: 'Observability Platform', type: 'observability', x: 860, y: 380, health: 'healthy', meta: {}, badges: ['MTTR: 17m'] }
    auditNode = { id: 'audit', label: 'Audit Records', type: 'observability', x: 860, y: 460, health: 'healthy', meta: {}, badges: ['Retention: 30d'] }
    nodes.push(agentNode, llmAgent, policyNode, externalNode, obsNode, auditNode)

    // Create tool nodes and edges
    const webTools = new Set(['agent_web_search', 'agent_fetch_url', 'agent_http_head'])
    let xIndex = 0
    for (const [tool, acc] of byTool.entries()) {
        const x = 80 + (xIndex % 3) * 240
        const y = 260 + Math.floor(xIndex / 3) * 120
        xIndex += 1
        const acl = AGENT_TOOL_ACL[tool] || 'PUBLIC'
        const toolNode: NodeDatum = { id: tool, label: tool.replace('agent_', ''), type: 'service', x, y, health: 'healthy', acl, meta: { calls: acc.count, p95_ms: p95(acc.durations) || 0, error_rate: acc.count ? Math.round((acc.errors / acc.count) * 100) : 0 }, badges: [`ACL: ${acl}`] }
        nodes.push(toolNode)

        const p95ms = p95(acc.durations)
        const outcome: PolicyOutcome = acc.blocked > 0 ? 'block' : 'governed'
        const recentSorted = acc.recent.sort((a, b) => {
            const ta = Date.parse(a.t)
            const tb = Date.parse(b.t)
            if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
            return tb - ta
        }).slice(0, 6)
        const edge: EdgeDatum = {
            id: `e-${tool}`,
            from: 'demoagent',
            to: tool,
            kind: 'tool_call',
            volumePerHour: windowHours > 0 ? acc.count / windowHours : acc.count,
            outcome,
            aclMax: acl,
            policyName: tool,
            needsApproval: acc.needsApproval,
            escalated: acc.escalated,
            risk: acc.blocked > 0 ? { blocks: acc.blocked } : undefined,
            latencyMsP95: p95ms,
            errorRate: acc.count ? acc.errors / acc.count : 0,
            recent: recentSorted,
        }
        edges.push(edge)

        if (webTools.has(tool)) {
            edges.push({
                id: `w-${tool}`,
                from: tool,
                to: 'external',
                kind: 'egress',
                volumePerHour: windowHours > 0 ? acc.count / windowHours : acc.count,
                outcome: outcome === 'block' ? 'block' : 'governed',
                aclMax: acl,
                policyName: 'exfiltration-blocker',
                latencyMsP95: p95ms,
                errorRate: acc.count ? acc.errors / acc.count : 0,
                recent: recentSorted,
            })
        }
    }

    // Static governance/infra edges
    edges.push({ id: 'e-authz', from: 'demoagent', to: 'openedison', kind: 'authz', volumePerHour: windowHours > 0 ? sessionsInWindow / windowHours : sessionsInWindow, outcome: 'governed', aclMax: 'PUBLIC', policyName: 'session-acl' })
    edges.push({ id: 'e-policy', from: 'policy', to: 'openedison', kind: 'policy_push', volumePerHour: windowHours > 0 ? 1 / windowHours : 1, outcome: 'governed', aclMax: 'PUBLIC', policyName: 'publish' })
    // Sinks: Observability and Audit
    const callsPerHour = windowHours > 0 ? totalAgentCalls / windowHours : totalAgentCalls
    if (obsNode && auditNode && policyNode && agentNode) {
        obsNode.meta = { ...obsNode.meta, ingest_per_h: Math.round(callsPerHour) }
        auditNode.meta = { ...auditNode.meta, writes_per_h: Math.round(callsPerHour) }
        policyNode.meta = { ...policyNode.meta, decisions_per_h: Math.round(callsPerHour) }
        edges.push({ id: 'e-obs', from: 'openedison', to: 'obs', kind: 'events', volumePerHour: callsPerHour, outcome: 'governed', aclMax: 'PUBLIC', policyName: 'metrics' })
        edges.push({ id: 'e-audit', from: 'openedison', to: 'audit', kind: 'audit', volumePerHour: callsPerHour, outcome: 'governed', aclMax: 'PUBLIC', policyName: 'audit-log' })
    }

    return { nodes, edges }
}

export function AgentDataflow({ sessions, startDay, endDay, msStart, msEnd }: { sessions: Session[]; startDay?: string; endDay?: string; msStart?: number; msEnd?: number }) {
    const filteredByDay = React.useMemo(() => filterSessionsByDayRange(sessions, startDay, endDay), [sessions, startDay, endDay])
    const filtered = React.useMemo(() => filterSessionsByMsRange(filteredByDay, msStart, msEnd), [filteredByDay, msStart, msEnd])
    const { nodes, edges } = React.useMemo(() => computeGraphFromSessions(filtered, { start: msStart, end: msEnd }), [filtered, msStart, msEnd])
    const [hoverNode, setHoverNode] = React.useState<string | null>(null)
    const [hoverEdge, setHoverEdge] = React.useState<string | null>(null)
    const [selectedNode, setSelectedNode] = React.useState<string | null>(null)
    const [showOutcome, setShowOutcome] = React.useState<{ allow: boolean; redact: boolean; block: boolean; governed: boolean }>({ allow: true, redact: true, block: true, governed: true })
    const [showExternal, setShowExternal] = React.useState(true)
    const [running, setRunning] = React.useState(true)
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const svgRef = React.useRef<SVGSVGElement | null>(null)
    const BASE_W = 1000
    const BASE_H = 520
    const [dims, setDims] = React.useState<{ w: number; h: number }>({ w: BASE_W, h: BASE_H })

    type SimNode = { id: string; x: number; y: number; vx: number; vy: number; mass: number }
    const simRef = React.useRef<Map<string, SimNode> | null>(null)
    const posCacheRef = React.useRef<Map<string, { x: number; y: number }>>(new Map())
    const svgBoundsRef = React.useRef<{ w: number; h: number }>({ w: BASE_W, h: BASE_H })
    const [, setTock] = React.useState(0)
    const [edgePopover, setEdgePopover] = React.useState<{ id: string; x: number; y: number } | null>(null)

    React.useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new (window as any).ResizeObserver((entries: any[]) => {
            for (const entry of entries) {
                const rect = entry.contentRect as DOMRectReadOnly
                const w = Math.max(720, Math.round(rect.width))
                const targetRatio = BASE_H / BASE_W
                const maxH = Math.max(400, Math.round(window.innerHeight * 0.6))
                const h = Math.max(400, Math.min(maxH, Math.round(w * targetRatio)))
                setDims({ w, h })
            }
        })
        ro.observe(el)
        const rect = el.getBoundingClientRect()
        const w = Math.max(720, Math.round(rect.width))
        const targetRatio = BASE_H / BASE_W
        const maxH = Math.max(400, Math.round(window.innerHeight * 0.6))
        const h = Math.max(400, Math.min(maxH, Math.round(w * targetRatio)))
        setDims({ w, h })
        return () => ro.disconnect()
    }, [])

    React.useEffect(() => {
        const m = simRef.current ?? new Map<string, SimNode>()
        const keepIds = new Set<string>()
        for (const n of nodes) {
            const { w, h } = getNodeSize(n)
            const pinned = n.id === 'openedison' || n.id === 'demoagent'
            const existing = m.get(n.id)
            if (existing) {
                if (pinned) {
                    existing.x = n.x
                    existing.y = n.y
                    existing.vx = 0
                    existing.vy = 0
                    existing.mass = Number.POSITIVE_INFINITY
                } else {
                    // Preserve position; just refresh mass
                    existing.mass = Math.max(1, (w * h) / 3000)
                }
            } else {
                const jitterX = (Math.random() - 0.5) * 20
                const jitterY = (Math.random() - 0.5) * 20
                const cached = posCacheRef.current.get(n.id)
                m.set(n.id, {
                    id: n.id,
                    x: pinned ? n.x : (cached ? cached.x : n.x + jitterX),
                    y: pinned ? n.y : (cached ? cached.y : n.y + jitterY),
                    vx: 0,
                    vy: 0,
                    mass: pinned ? Number.POSITIVE_INFINITY : Math.max(1, (w * h) / 3000),
                })
            }
            keepIds.add(n.id)
        }
        // Remove nodes that disappeared, but keep last known position in cache
        for (const id of Array.from(m.keys())) {
            if (!keepIds.has(id)) {
                const gone = m.get(id)
                if (gone) posCacheRef.current.set(id, { x: gone.x, y: gone.y })
                m.delete(id)
            }
        }
        simRef.current = m
    }, [nodes])

    React.useEffect(() => {
        let raf = 0
        let last = performance.now()
        const run = () => {
            raf = requestAnimationFrame(run)
            if (!running) return
            const now = performance.now()
            const dtMs = Math.min(32, now - last)
            last = now
            const dt = dtMs / 1000
            const sim = simRef.current
            if (!sim) return

            const kRepelN = 1200
            const kSpring = 2.2
            const springRestBase = 220
            const damping = 0.85
            const centerPull = 0.4
            const { w: viewW, h: viewH } = svgBoundsRef.current
            const cx = viewW / 2
            const cy = viewH / 2
            const scaleX = Math.max(0.001, viewW / BASE_W)
            const scaleY = Math.max(0.001, viewH / BASE_H)

            const nodesArr = Array.from(sim.values())
            for (let i = 0; i < nodesArr.length; i++) {
                const a = nodesArr[i]!
                // Keep pinned and dragging nodes fixed
                if (a.id === 'openedison' || a.id === 'demoagent' || (drag && a.id === drag.id)) {
                    a.vx = 0
                    a.vy = 0
                    continue
                }
                let fxAccumN = 0
                let fyAccumN = 0
                for (let j = 0; j < nodesArr.length; j++) {
                    if (i === j) continue
                    const b = nodesArr[j]!
                    const axN = a.x / scaleX
                    const ayN = a.y / scaleY
                    const bxN = b.x / scaleX
                    const byN = b.y / scaleY
                    const dxN = axN - bxN
                    const dyN = ayN - byN
                    const distSqN = Math.max(64, dxN * dxN + dyN * dyN)
                    const invDistN = 1 / Math.sqrt(distSqN)
                    const forceN = (kRepelN * kRepelN) / distSqN
                    fxAccumN += forceN * dxN * invDistN
                    fyAccumN += forceN * dyN * invDistN
                }
                fxAccumN += ((cx - a.x) / scaleX) * centerPull
                fyAccumN += ((cy - a.y) / scaleY) * centerPull
                const fx = fxAccumN * scaleX
                const fy = fyAccumN * scaleY
                a.vx = (a.vx + (fx / a.mass) * dt) * damping
                a.vy = (a.vy + (fy / a.mass) * dt) * damping
            }

            for (const e of edges) {
                const from = sim.get(e.from)
                const to = sim.get(e.to)
                if (!from || !to) continue
                // Springs should not move pinned or dragging nodes
                if (
                    from.id === 'openedison' || from.id === 'demoagent' ||
                    to.id === 'openedison' || to.id === 'demoagent' ||
                    (drag && (from.id === drag.id || to.id === drag.id))
                ) {
                    // compute but only apply to the non-pinned side
                    const fxN0 = from.x / scaleX
                    const fyN0 = from.y / scaleY
                    const txN0 = to.x / scaleX
                    const tyN0 = to.y / scaleY
                    const dxN = txN0 - fxN0
                    const dyN = tyN0 - fyN0
                    const distN = Math.max(1, Math.hypot(dxN, dyN))
                    const dirXN = dxN / distN
                    const dirYN = dyN / distN
                    const restN = springRestBase + (e.outcome === 'block' ? 10 : 0) + (e.escalated ? 40 : 0)
                    const stretchN = distN - restN
                    const forceN = kSpring * stretchN
                    const fx = forceN * dirXN * scaleX
                    const fy = forceN * dirYN * scaleY
                    if (from.id === 'openedison' || from.id === 'demoagent' || (drag && from.id === drag.id)) {
                        to.vx -= (fx / to.mass) * dt
                        to.vy -= (fy / to.mass) * dt
                    } else if (to.id === 'openedison' || to.id === 'demoagent' || (drag && to.id === drag.id)) {
                        from.vx += (fx / from.mass) * dt
                        from.vy += (fy / from.mass) * dt
                    }
                    continue
                }
                const fxN0 = from.x / scaleX
                const fyN0 = from.y / scaleY
                const txN0 = to.x / scaleX
                const tyN0 = to.y / scaleY
                const dxN = txN0 - fxN0
                const dyN = tyN0 - fyN0
                const distN = Math.max(1, Math.hypot(dxN, dyN))
                const dirXN = dxN / distN
                const dirYN = dyN / distN
                const restN = springRestBase + (e.outcome === 'block' ? 10 : 0) + (e.escalated ? 40 : 0)
                const stretchN = distN - restN
                const forceN = kSpring * stretchN
                const fx = forceN * dirXN * scaleX
                const fy = forceN * dirYN * scaleY
                from.vx += (fx / from.mass) * dt
                from.vy += (fy / from.mass) * dt
                to.vx -= (fx / to.mass) * dt
                to.vy -= (fy / to.mass) * dt
            }

            const margin = 20
            for (const n of sim.values()) {
                // keep pinned nodes fixed in place (ignore drag pin for now)
                if (n.id === 'openedison' || n.id === 'demoagent') {
                    // keep pinned nodes fixed in place
                    continue
                }
                n.x += n.vx
                n.y += n.vy
                n.x = Math.max(margin, Math.min(viewW - margin, n.x))
                n.y = Math.max(margin, Math.min(viewH - margin, n.y))
            }

            setTock((t) => (t + 1) % 1_000_000)
        }
        raf = requestAnimationFrame(run)
        return () => cancelAnimationFrame(raf)
    }, [edges, running])

    const visibleEdges = edges.filter((e) => showOutcome[e.outcome] && (showExternal || (e.from !== 'external' && e.to !== 'external')))

    function edgeOpacity(e: EdgeDatum): number {
        if (hoverEdge && hoverEdge !== e.id) return 0.2
        if (hoverNode && !(e.from === hoverNode || e.to === hoverNode)) return 0.15
        if (selectedNode && !(e.from === selectedNode || e.to === selectedNode)) return 0.1
        return 1
    }

    function nodeOpacity(n: NodeDatum): number {
        if (hoverEdge) {
            const he = edges.find((x) => x.id === hoverEdge)
            if (he && !(he.from === n.id || he.to === n.id)) return 0.2
        }
        if (hoverNode && hoverNode !== n.id) return 0.2
        return 1
    }

    function labelForEdge(e: EdgeDatum): string {
        const policy = e.policyName ? ` • policy: ${e.policyName}` : ''
        return `${e.kind} • ${formatRatePerHour(e.volumePerHour)}${policy}`
    }

    function formatRecent(rc: RecentCall): string {
        const time = (() => {
            try {
                const d = new Date(rc.t)
                const iso = d.toISOString().replace('T', ' ').replace('Z', '')
                return iso.slice(0, 19)
            } catch {
                return rc.t
            }
        })()
        const dur = rc.d != null ? `${Math.round(rc.d)}ms` : '—'
        const status = rc.s || 'ok'
        return `${time} — ${dur} — ${status}`
    }

    const viewW = dims.w
    const viewH = dims.h
    React.useEffect(() => {
        svgBoundsRef.current = { w: viewW, h: viewH }
    }, [viewW, viewH])

    // Compute dynamic viewBox to include all nodes with a margin
    function computeViewBox(): { x: number; y: number; w: number; h: number } {
        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY
        for (const n of nodes) {
            const { w, h } = getNodeSize(n)
            const sim = simRef.current?.get(n.id)
            const nx = (sim?.x ?? n.x)
            const ny = (sim?.y ?? n.y)
            if (nx < minX) minX = nx
            if (ny < minY) minY = ny
            if (nx + w > maxX) maxX = nx + w
            if (ny + h > maxY) maxY = ny + h
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return { x: 0, y: 0, w: viewW, h: viewH }
        }
        const M = 30
        const w = Math.max(100, (maxX - minX) + M * 2)
        const h = Math.max(100, (maxY - minY) + M * 2)
        const x = minX - M
        const y = minY - M
        return { x, y, w, h }
    }

    const vb = computeViewBox()
    const vbStr = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`
    const vbScale = Math.min(viewW / vb.w, viewH / vb.h)
    const vbOffX = (viewW - vb.w * vbScale) / 2
    const vbOffY = (viewH - vb.h * vbScale) / 2

    function toPixels(x: number, y: number): { px: number; py: number } {
        return { px: vbOffX + (x - vb.x) * vbScale, py: vbOffY + (y - vb.y) * vbScale }
    }

    function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
        const svg = svgRef.current
        if (!svg) return { x: 0, y: 0 }
        const rect = svg.getBoundingClientRect()
        const px = clientX - rect.left
        const py = clientY - rect.top
        const x = vb.x + (px - vbOffX) / Math.max(0.0001, vbScale)
        const y = vb.y + (py - vbOffY) / Math.max(0.0001, vbScale)
        return { x, y }
    }

    function filterSessionsByDayRange(sessionsIn: Session[], start?: string, end?: string): Session[] {
        if (!start && !end) return sessionsIn
        function keep(tsIso?: string): boolean {
            if (!tsIso) return false
            const day = tsIso.slice(0, 10)
            if (start && day < start) return false
            if (end && day > end) return false
            return true
        }
        return sessionsIn.map(s => ({
            ...s,
            tool_calls: s.tool_calls.filter(tc => keep(tc.timestamp))
        })).filter(s => s.tool_calls.length > 0)
    }

    function filterSessionsByMsRange(sessionsIn: Session[], startMs?: number, endMs?: number): Session[] {
        if (typeof startMs !== 'number' && typeof endMs !== 'number') return sessionsIn
        return sessionsIn.map(s => ({
            ...s,
            tool_calls: s.tool_calls.filter(tc => {
                const t = Date.parse(String(tc.timestamp || ''))
                if (Number.isNaN(t)) return false
                if (typeof startMs === 'number' && t < startMs) return false
                if (typeof endMs === 'number' && t > endMs) return false
                return true
            })
        })).filter(s => s.tool_calls.length > 0)
    }

    const [drag, setDrag] = React.useState<{ id: string; dx: number; dy: number } | null>(null)

    React.useEffect(() => {
        function onMove(ev: MouseEvent) {
            if (!drag) return
            const sim = simRef.current
            if (!sim) return
            const p = clientToSvg(ev.clientX, ev.clientY)
            const node = sim.get(drag.id)
            if (!node) return
            node.x = p.x - drag.dx
            node.y = p.y - drag.dy
            node.vx = 0
            node.vy = 0
            posCacheRef.current.set(drag.id, { x: node.x, y: node.y })
            setTock((t) => t + 1)
        }
        function onUp() { setDrag(null) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    }, [drag])

    function transformForNode(id: string): React.CSSProperties['transform'] {
        if (selectedNode === id) return 'scale(1.04)'
        if (hoverNode === id) return 'scale(1.02)'
        return undefined
    }

    return (
        <div className="card">
            <div className="text-sm opacity-80 mb-2">Demo Agent Dataflow</div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={showOutcome.allow} onChange={(e) => setShowOutcome((s) => ({ ...s, allow: e.target.checked }))} /> Allowed</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={showOutcome.redact} onChange={(e) => setShowOutcome((s) => ({ ...s, redact: e.target.checked }))} /> Redacted</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={showOutcome.block} onChange={(e) => setShowOutcome((s) => ({ ...s, block: e.target.checked }))} /> Blocked</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={showOutcome.governed} onChange={(e) => setShowOutcome((s) => ({ ...s, governed: e.target.checked }))} /> Governed</label>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={showExternal} onChange={(e) => setShowExternal(e.target.checked)} /> Show external flows</label>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <button className="text-sm" onClick={() => setRunning((r) => !r)}>{running ? 'Stabilize' : 'Resume'}</button>
                    <button className="text-sm" onClick={() => {
                        const sim = simRef.current
                        if (!sim) return
                        for (const n of nodes) {
                            const s = sim.get(n.id)
                            if (!s) continue
                            s.x = n.x
                            s.y = n.y
                            s.vx = 0
                            s.vy = 0
                        }
                        setRunning(true)
                        setTock((t) => t + 1)
                    }}>Reset</button>
                </div>
            </div>
            <div className="border border-app-border rounded" style={{ position: 'relative' }} ref={containerRef}>
                <svg ref={svgRef} width="100%" height={viewH} viewBox={vbStr} preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <marker id="arrow-allow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L0,6 L9,3 z" fill={OUTCOME_COLORS.allow} />
                        </marker>
                        <marker id="arrow-redact" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L0,6 L9,3 z" fill={OUTCOME_COLORS.redact} />
                        </marker>
                        <marker id="arrow-block" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L0,6 L9,3 z" fill={OUTCOME_COLORS.block} />
                        </marker>
                        <marker id="arrow-governed" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                            <path d="M0,0 L0,6 L9,3 z" fill={OUTCOME_COLORS.governed} />
                        </marker>
                        {visibleEdges.map((e) => (
                            e.escalated ? (
                                <linearGradient key={e.id} id={`grad-${e.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#f59e0b" />
                                    <stop offset="100%" stopColor="#ef4444" />
                                </linearGradient>
                            ) : null
                        ))}
                        <filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.22" />
                        </filter>
                        <linearGradient id="nodeGloss" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
                            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.03" />
                            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {visibleEdges.map((e) => {
                        const from = nodes.find((n) => n.id === e.from)!
                        const to = nodes.find((n) => n.id === e.to)!
                        const fromSim = simRef.current?.get(from.id)
                        const toSim = simRef.current?.get(to.id)
                        const { w: fw, h: fh } = getNodeSize(from)
                        const { w: tw, h: th } = getNodeSize(to)
                        const cx1 = (fromSim?.x ?? from.x) + fw / 2
                        const cy1 = (fromSim?.y ?? from.y) + fh / 2
                        const cx2 = (toSim?.x ?? to.x) + tw / 2
                        const cy2 = (toSim?.y ?? to.y) + th / 2
                        function edgePointRect(cx: number, cy: number, w: number, h: number, tx: number, ty: number) {
                            const dx = tx - cx
                            const dy = ty - cy
                            if (dx === 0 && dy === 0) return { x: cx, y: cy }
                            const absDx = Math.abs(dx)
                            const absDy = Math.abs(dy)
                            const hw = w / 2
                            const hh = h / 2
                            // Decide which side gets hit first
                            if (absDx * hh >= absDy * hw) {
                                const s = hw / absDx
                                return { x: cx + dx * s, y: cy + dy * s }
                            } else {
                                const s = hh / absDy
                                return { x: cx + dx * s, y: cy + dy * s }
                            }
                        }
                        const p1 = edgePointRect(cx1, cy1, fw, fh, cx2, cy2)
                        const p2 = edgePointRect(cx2, cy2, tw, th, cx1, cy1)
                        const x1 = p1.x
                        const y1 = p1.y
                        const x2 = p2.x
                        const y2 = p2.y
                        const midX = (x1 + x2) / 2
                        const midY = (y1 + y2) / 2
                        const stroke = e.escalated ? `url(#grad-${e.id})` : strokeForOutcome(e.outcome)
                        const markerEnd = `url(#arrow-${e.outcome})`
                        const dash = e.needsApproval ? '6 4' : e.simulated ? '2 6' : undefined
                        const sw = volumeToWidth(e.volumePerHour)
                        const op = edgeOpacity(e)
                        const { px, py } = toPixels(midX, midY)
                        return (
                            <g key={e.id} opacity={op} onMouseEnter={() => { setHoverEdge(e.id); setEdgePopover({ id: e.id, x: px, y: py }) }} onMouseLeave={() => { setHoverEdge(null); setEdgePopover(null) }}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} markerEnd={markerEnd} strokeDasharray={dash} />
                                <text x={midX} y={midY - 8} textAnchor="middle" fill="#a0a7b4" fontSize={9} style={{ userSelect: 'none' }}>{labelForEdge(e)}</text>
                                <g transform={`translate(${midX}, ${midY + 8})`}>
                                    {(() => {
                                        const tag = e.outcome
                                        const approxCharW = 5.5 // for fontSize 9
                                        const tagW = Math.max(36, Math.round(tag.length * approxCharW) + 12)
                                        return (
                                            <>
                                                <rect x={-tagW / 2} y={-9} width={tagW} height={14} rx={7} ry={7} fill={OUTCOME_COLORS[e.outcome]} />
                                                <text x={0} y={2} textAnchor="middle" fontSize={9} fill="#0b0c10" style={{ userSelect: 'none' }}>{tag}</text>
                                            </>
                                        )
                                    })()}
                                </g>
                                {e.risk && (e.risk.trifecta || e.risk.blocks || e.risk.jailbreak) ? (
                                    <text x={midX} y={midY + 24} textAnchor="middle" fill="#f59e0b" fontSize={10} style={{ userSelect: 'none' }}>
                                        {`risk: ${e.risk.trifecta ? `trifecta=${e.risk.trifecta} ` : ''}${e.risk.blocks ? `blocks=${e.risk.blocks} ` : ''}${e.risk.jailbreak ? `jailbreak=${e.risk.jailbreak}` : ''}`.trim()}
                                    </text>
                                ) : null}
                                {e.recent && e.recent.length > 0 ? (
                                    <title>
                                        {`Recent calls\n${e.recent.map(formatRecent).join('\n')}`}
                                    </title>
                                ) : null}
                            </g>
                        )
                    })}

                    {/* Draw non-pinned nodes first */}
                    {nodes.filter(n => !(n.id === 'openedison' || n.id === 'demoagent')).map((n) => {
                        const { w, h } = getNodeSize(n)
                        const fill = nodeFill(n)
                        const stroke = 'var(--border)'
                        const op = nodeOpacity(n)
                        const show = showExternal || n.id !== 'external'
                        if (!show) return null
                        const sim = simRef.current?.get(n.id)
                        const nx = (sim?.x ?? n.x)
                        const ny = (sim?.y ?? n.y)
                        return (
                            <g key={n.id} opacity={op} onMouseEnter={() => { setHoverNode(n.id) }} onMouseLeave={() => { setHoverNode(null) }} onMouseDown={(ev) => {
                                if (n.id === 'openedison' || n.id === 'demoagent') return
                                const p = clientToSvg(ev.clientX, ev.clientY)
                                setDrag({ id: n.id, dx: p.x - nx, dy: p.y - ny })
                            }} onClick={() => setSelectedNode(n.id)} style={{ cursor: 'grab', transform: transformForNode(n.id), transformOrigin: 'center center', transition: 'transform 120ms ease-out' }}>
                                {n.type === 'datastore' ? (
                                    <Cylinder x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                ) : n.type === 'security' ? (
                                    <Hexagon x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                ) : n.type === 'external' ? (
                                    <Pill x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                ) : (
                                    <Rounded x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                )}
                                <text x={nx + w / 2} y={ny + h / 2 + 4} textAnchor="middle" fill="var(--text)" fontSize={12} style={{ userSelect: 'none' }}>{n.label}</text>
                                <g transform={`translate(${nx + 12}, ${ny + 10})`}>
                                    {n.badges?.slice(0, 2).map((b, i) => (
                                        <g key={i} transform={`translate(${i * 90}, 0)`}>
                                            <rect x={0} y={-10} width={80} height={18} rx={9} ry={9} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.06)" />
                                            <text x={40} y={3} textAnchor="middle" fill="#a0a7b4" fontSize={10} style={{ userSelect: 'none' }}>{b}</text>
                                        </g>
                                    ))}
                                </g>
                                {n.acl ? (
                                    <g transform={`translate(${nx + w - 70}, ${ny + 10})`}>
                                        <rect x={0} y={-10} width={60} height={18} rx={9} ry={9} fill={ACL_COLORS[n.acl]} />
                                        <text x={30} y={3} textAnchor="middle" fill="#0b0c10" fontSize={10} style={{ userSelect: 'none' }}>{n.acl}</text>
                                    </g>
                                ) : null}
                                <title>
                                    {`${n.label}\n${Object.entries(n.meta).map(([k, v]) => `${k}: ${String(v)}`).join('\n')}`}
                                </title>
                            </g>
                        )
                    })}

                    {/* Draw pinned nodes last to keep them on top */}
                    {nodes.filter(n => (n.id === 'openedison' || n.id === 'demoagent')).map((n) => {
                        const { w, h } = getNodeSize(n)
                        const fill = nodeFill(n)
                        const stroke = 'var(--border)'
                        const op = nodeOpacity(n)
                        const sim = simRef.current?.get(n.id)
                        const nx = (sim?.x ?? n.x)
                        const ny = (sim?.y ?? n.y)
                        return (
                            <g key={n.id} opacity={op} onMouseEnter={() => { setHoverNode(n.id) }} onMouseLeave={() => { setHoverNode(null) }} onClick={() => setSelectedNode(n.id)} style={{ cursor: 'default', transform: transformForNode(n.id), transformOrigin: 'center center', transition: 'transform 120ms ease-out' }}>
                                <Rounded x={nx} y={ny} w={w} h={h} fill={fill} stroke={stroke} />
                                <text x={nx + w / 2} y={ny + h / 2 + 4} textAnchor="middle" fill="var(--text)" fontSize={12} style={{ userSelect: 'none' }}>{n.label}</text>
                                {n.acl ? (
                                    <g transform={`translate(${nx + w - 70}, ${ny + 10})`}>
                                        <rect x={0} y={-10} width={60} height={18} rx={9} ry={9} fill={ACL_COLORS[n.acl]} />
                                        <text x={30} y={3} textAnchor="middle" fill="#0b0c10" fontSize={10} style={{ userSelect: 'none' }}>{n.acl}</text>
                                    </g>
                                ) : null}
                                <title>
                                    {`${n.label}\n${Object.entries(n.meta).map(([k, v]) => `${k}: ${String(v)}`).join('\n')}`}
                                </title>
                            </g>
                        )
                    })}
                </svg>

                {edgePopover ? (() => {
                    const e = edges.find(x => x.id === edgePopover.id)
                    if (!e) return null
                    const lines: string[] = []
                    lines.push(`Rate: ${formatRatePerHour(e.volumePerHour)}`)
                    if (typeof e.latencyMsP95 === 'number') lines.push(`p95: ${Math.round(e.latencyMsP95)}ms`)
                    if (typeof e.errorRate === 'number') lines.push(`Errors: ${Math.round(e.errorRate * 100)}%`)
                    lines.push(`ACL: ${e.aclMax}`)
                    lines.push(`Outcome: ${e.outcome}${e.policyName ? ` (${e.policyName})` : ''}`)
                    const recent = (e.recent || []).map(formatRecent)
                    return (
                        <div className="card" style={{ position: 'absolute', left: edgePopover.x + 12, top: edgePopover.y + 12, width: 320, padding: 12, pointerEvents: 'none' }}>
                            <div className="text-xs opacity-70 mb-1">{e.kind}</div>
                            <div className="space-y-1 text-xs mb-2">
                                {lines.map((t, i) => (<div key={i}>{t}</div>))}
                            </div>
                            {recent.length > 0 && (
                                <div className="text-xs">
                                    <div className="opacity-70 mb-1">Recent</div>
                                    <div className="space-y-1">
                                        {recent.slice(0, 6).map((t, i) => (<div key={i} className="font-mono">{t}</div>))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })() : null}

                <div className="card" style={{ position: 'absolute', left: 12, bottom: 12, width: 320, padding: 12 }}>
                    <div className="text-sm opacity-80 mb-2">Legend</div>
                    <div className="text-xs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: OUTCOME_COLORS.allow, color: '#0b0c10' }}>Allowed</span><span className="opacity-80">edge</span></div>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: OUTCOME_COLORS.redact, color: '#0b0c10' }}>Redacted</span><span className="opacity-80">edge</span></div>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: OUTCOME_COLORS.block, color: '#0b0c10' }}>Blocked</span><span className="opacity-80">edge</span></div>
                        <div className="flex items-center gap-2"><span className="pill" style={{ background: OUTCOME_COLORS.governed, color: '#0b0c10' }}>Governed</span><span className="opacity-80">edge</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Agent</span><span className="opacity-80">rounded</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Service</span><span className="opacity-80">rounded</span></div>
                        <div className="flex items-center gap-2"><span className="badge">External</span><span className="opacity-80">capsule</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Policy</span><span className="opacity-80">rounded</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Observability</span><span className="opacity-80">rounded</span></div>
                        <div className="flex items-center gap-2"><span className="badge">ACL</span><span className="opacity-80">node badge</span></div>
                        <div className="flex items-center gap-2"><span className="badge">Policy</span><span className="opacity-80">edge tag</span></div>
                    </div>
                </div>

                {selectedNode ? (() => {
                    const n = nodes.find((x) => x.id === selectedNode)!
                    // const { w, h } = getNodeSize(n)
                    return (
                        <div className="card" style={{ position: 'absolute', right: 12, top: 12, width: 320, padding: 12 }}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm"><strong>{n.label}</strong></div>
                                <button className="text-sm" onClick={() => setSelectedNode(null)}>Close</button>
                            </div>
                            <div className="text-xs opacity-80 mb-2">Type: {n.type} • Health: {n.health}</div>
                            <div className="space-y-1 text-sm">
                                {Object.entries(n.meta).map(([k, v]) => (
                                    <div key={k} className="flex items-center justify-between"><span className="opacity-70">{k}</span><span>{String(v)}</span></div>
                                ))}
                            </div>
                            <div className="text-xs opacity-70 mt-3">Connected flows:</div>
                            <div className="space-y-1 mt-1 text-xs">
                                {edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => (
                                    <div key={e.id} className="flex items-center justify-between">
                                        <span>{e.from === n.id ? '→' : '←'} {e.from === n.id ? e.to : e.from}</span>
                                        <span className="badge" style={{ background: OUTCOME_COLORS[e.outcome], color: '#0b0c10' }}>{e.outcome}</span>
                                    </div>
                                ))}
                            </div>
                            {/* Uses Observability page date range */}
                        </div>
                    )
                })() : null}
            </div>
        </div>
    )
}

export default AgentDataflow


