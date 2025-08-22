import React, { useEffect, useMemo, useState } from 'react'
import './index.css'
import Editor from '@monaco-editor/react'
import { useSessions } from './hooks'
import type { Session, OAuthServerInfo, OAuthStatusResponse, OAuthAuthorizeRequest, OAuthStatus } from './types'
import { Timeline } from './components/Timeline'
import { SessionTable } from './components/SessionTable'
import { Toggle } from './components/Toggle'


export function App(): React.JSX.Element {
    // Always read from sessions.db (canonical name)
    const dbRelativeToProjectRoot = '/sessions.db'
    // Vite injects __PROJECT_ROOT__ from vite.config.ts define
    const dbAbsolutePath = (globalThis as any).__PROJECT_ROOT__
        ? `${(globalThis as any).__PROJECT_ROOT__}${dbRelativeToProjectRoot}`
        : `${window.location.pathname}${dbRelativeToProjectRoot}`
    const { data, loading, error } = useSessions(dbAbsolutePath)

    type UISession = Session & { ts: number; day: string }
    const sessions = useMemo(() => (data?.sessions ?? []) as Session[], [data])
    const uiSessions: UISession[] = useMemo(() => {
        return (data?.sessions ?? []).map((s) => {
            const firstTs = s.tool_calls[0]?.timestamp
            const ts = firstTs ? Date.parse(firstTs) : 0
            const day = firstTs ? new Date(ts).toISOString().slice(0, 10) : ''
            return { ...s, ts, day }
        })
    }, [data])

    // Day range filter (calendar selectors)
    const [startDay, setStartDay] = useState<string>('')
    const [endDay, setEndDay] = useState<string>('')

    const compareDays = (a?: string, b?: string) => {
        if (!a && !b) return 0
        if (!a) return -1
        if (!b) return 1
        return a.localeCompare(b)
    }

    const filtered = useMemo(() => {
        return uiSessions.filter((s) => {
            if (!s.day) return true
            if (startDay && compareDays(s.day, startDay) < 0) return false
            if (endDay && compareDays(s.day, endDay) > 0) return false
            return true
        })
    }, [uiSessions, startDay, endDay])

    const totalCalls = useMemo(() => filtered.reduce((acc, s) => acc + s.tool_calls.length, 0), [filtered])
    const [theme, setTheme] = useState<'light' | 'dark'>(() => (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    const projectRoot = (globalThis as any).__PROJECT_ROOT__ || ''

    const [view, setView] = useState<'sessions' | 'configs' | 'manager'>('sessions')

    // MCP Server Status
    const [mcpStatus, setMcpStatus] = useState<'checking' | 'online' | 'reduced' | 'offline'>('checking')

    // App-level toast (e.g., approval confirmations)
    const [uiToast, setUiToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    useEffect(() => {
        if (!uiToast) return
        const t = setTimeout(() => setUiToast(null), 5000)
        return () => clearTimeout(t)
    }, [uiToast])

    useEffect(() => {
        const checkMcpStatus = async () => {
            try {
                console.log('🔄 Starting MCP status check...')

                // Load config to get server settings
                const configResponse = await fetch(`/@fs${projectRoot}/config.json`)
                if (!configResponse.ok) {
                    console.log('❌ Failed to load config.json')
                    setMcpStatus('offline')
                    return
                }

                const configData = await configResponse.json()
                const serverHost = configData?.server?.host || 'localhost'
                const basePort = configData?.server?.port || 3000
                const apiPort = basePort + 1
                const apiKey = configData?.server?.api_key || ''

                console.log('🔍 Checking servers:', {
                    serverHost,
                    basePort,
                    apiPort,
                    mcpUrl: `http://${serverHost}:${basePort}/`,
                    apiUrl: `http://${serverHost}:${apiPort}/health`
                })

                // Check both ports - API server has /health, MCP server we'll check with a GET request
                const [mcpResponse, apiResponse] = await Promise.allSettled([
                    fetch(`http://${serverHost}:${apiPort}/mcp/status`, {
                        method: 'GET',
                        mode: 'cors',
                        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` }
                    }),
                    fetch(`http://${serverHost}:${apiPort}/health`, {
                        method: 'GET',
                        mode: 'cors',
                        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` }
                    })
                ])

                console.log('📡 Raw responses:', {
                    mcpResponse: mcpResponse.status === 'fulfilled' ? {
                        status: mcpResponse.value.status,
                        statusText: mcpResponse.value.statusText,
                        ok: mcpResponse.value.ok
                    } : mcpResponse.reason,
                    apiResponse: apiResponse.status === 'fulfilled' ? {
                        status: apiResponse.value.status,
                        statusText: apiResponse.value.statusText,
                        ok: apiResponse.value.ok
                    } : apiResponse.reason
                })

                // For MCP server with no-cors, if the promise is fulfilled, the server is reachable
                const mcpOk = mcpResponse.status === 'fulfilled'
                const apiOk = apiResponse.status === 'fulfilled' && apiResponse.value.ok

                console.log('🔍 MCP Status Check:', {
                    mcpOk,
                    apiOk,
                    finalStatus: mcpOk && apiOk ? 'online' : mcpOk ? 'reduced' : 'offline'
                })

                if (mcpOk && apiOk) {
                    setMcpStatus('online')
                } else if (mcpOk) {
                    setMcpStatus('reduced')
                } else {
                    setMcpStatus('offline')
                }
            } catch (error) {
                console.error('❌ MCP status check error:', error)
                setMcpStatus('offline')
            }
        }

        checkMcpStatus()
        // Check status every 5 seconds
        const interval = setInterval(checkMcpStatus, 5000)
        return () => clearInterval(interval)
    }, [])

    // Register service worker (for actionable notifications) then subscribe to SSE
    useEffect(() => {
        // Try to register service worker if supported
        const registerSW = async () => {
            if ('serviceWorker' in navigator) {
                try {
                    // sw.js is served from public/
                    await navigator.serviceWorker.register('/sw.js');
                } catch {
                    // ignore
                }
            }
        }
        void registerSW();

        const es = new EventSource(`/events`)
        es.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data || '{}') as any
                if (data?.type === 'mcp_pre_block') {
                    const title = 'Edison blocked a risky action'
                    const body = `${data.kind}: ${data.name}${data.reason ? ` — ${data.reason}` : ''}`
                    const sessionId = data.session_id || ''
                    const trySW = async () => {
                        try {
                            if ('serviceWorker' in navigator && Notification) {
                                const ensurePerm = async () => {
                                    if (Notification.permission === 'granted') return true
                                    if (Notification.permission === 'denied') return false
                                    const p = await Notification.requestPermission();
                                    return p === 'granted'
                                }
                                const ok = await ensurePerm()
                                if (!ok) return false
                                const reg = await navigator.serviceWorker.ready
                                reg.active?.postMessage({
                                    type: 'SHOW_MCP_BLOCK_NOTIFICATION',
                                    title,
                                    body,
                                    data: { sessionId, kind: data.kind, name: data.name }
                                })
                                return true
                            }
                        } catch { /* ignore */ }
                        return false
                    }

                    const fallbackInline = () => {
                        if (typeof Notification === 'undefined') return
                        const show = () => {
                            try {
                                const n = new Notification(title, { body })
                                n.onclick = async () => {
                                    try {
                                        const ok = window.confirm(`Allow ${data.kind} '${data.name}' for this session?`)
                                        if (ok && sessionId) {
                                            await fetch(`/api/approve`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ session_id: sessionId, kind: data.kind, name: data.name })
                                            })
                                        }
                                    } catch { /* ignore */ }
                                }
                            } catch { /* ignore */ }
                        }
                        if (Notification.permission === 'granted') show()
                        else if (Notification.permission !== 'denied') {
                            Notification.requestPermission().then((p) => { if (p === 'granted') show() }).catch(() => { })
                        }
                    }

                    // Prefer SW (action buttons) and fall back to inline notification + confirm
                    void trySW().then((ok) => { if (!ok) fallbackInline() })
                } else if (data?.type === 'mcp_approved_once') {
                    const msg = `Approved ${data.kind} '${data.name}'`
                    setUiToast({ message: msg, type: 'success' })
                }
            } catch { /* ignore */ }
        }
        es.onerror = () => { /* auto-retry by browser */ }
        return () => { es.close() }
    }, [])

    return (
        <div className="mx-auto max-w-[1400px] p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="m-0 text-2xl font-bold">Open Edison Sessions</h1>
                    <p className="m-0 text-sm text-app-muted">Live view of recent MCP sessions from the local SQLite store.</p>
                </div>
                <div className="flex gap-2 items-center">
                    <div className="hidden sm:flex border border-app-border rounded overflow-hidden">
                        <button className={`px-3 py-1 text-sm ${view === 'sessions' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => setView('sessions')}>Sessions</button>
                        <button className={`px-3 py-1 text-sm ${view === 'configs' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => setView('configs')}>Configs</button>
                        <button className={`px-3 py-1 text-sm ${view === 'manager' ? 'text-app-accent bg-app-accent/10' : ''}`} onClick={() => setView('manager')}>Configuration Manager</button>
                    </div>
                    <button className="button" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
                        {theme === 'light' ? 'Dark' : 'Light'} mode
                    </button>
                    <button className="button" onClick={() => location.reload()}>Refresh</button>
                </div>
            </div>

            {view === 'sessions' ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="card flex items-center gap-3">
                            <div>
                                <div className="text-xs text-app-muted">Total sessions</div>
                                <div className="text-xl font-bold">{filtered.length}</div>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${mcpStatus === 'online' ? 'bg-green-500' :
                                    mcpStatus === 'reduced' ? 'bg-yellow-500' :
                                        mcpStatus === 'checking' ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
                                    }`}></div>
                                <div>
                                    <div className="text-xs text-app-muted">MCP Server</div>
                                    <div className={`text-xl font-bold ${mcpStatus === 'online' ? 'text-green-500' :
                                        mcpStatus === 'reduced' ? 'text-yellow-500' :
                                            mcpStatus === 'checking' ? 'text-blue-500' : 'text-red-500'
                                        }`}>
                                        {mcpStatus === 'online' ? 'Live' :
                                            mcpStatus === 'reduced' ? 'Reduced' :
                                                mcpStatus === 'checking' ? 'Checking...' : 'Offline'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <div>
                                <div className="text-xs text-app-muted">Total tool calls</div>
                                <div className="text-xl font-bold">{totalCalls}</div>
                            </div>
                        </div>
                    </div>

                    {/* Day controls */}
                    <div className="card flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                        <div className="flex flex-col">
                            <label className="text-xs text-app-muted mb-1">Start day</label>
                            <input
                                type="date"
                                className="button !py-2 !px-3"
                                value={startDay}
                                onChange={(e) => setStartDay(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs text-app-muted mb-1">End day</label>
                            <input
                                type="date"
                                className="button !py-2 !px-3"
                                value={endDay}
                                onChange={(e) => setEndDay(e.target.value)}
                            />
                        </div>
                        <button className="button" onClick={() => { setStartDay(''); setEndDay('') }}>Clear</button>
                    </div>

                    {/* Timeline with drag selection */}
                    <Timeline
                        sessions={uiSessions}
                        startDay={startDay}
                        endDay={endDay}
                        onRangeChange={(s, e) => { setStartDay(s); setEndDay(e) }}
                    />

                    {loading && <div>Loading…</div>}
                    {error && (
                        <div className="danger" style={{ margin: '8px 0' }}>
                            Failed to load sessions: {error}
                        </div>
                    )}

                    {!loading && !error && sessions.length === 0 && (
                        <div className="muted" style={{ marginTop: 12 }}>No sessions recorded yet.</div>
                    )}

                    <SessionTable sessions={filtered} />
                </div>
            ) : view === 'configs' ? (
                <JsonEditors projectRoot={projectRoot} />
            ) : (
                <ConfigurationManager projectRoot={projectRoot} />
            )}
            {/* Global toast for cross-page confirmations */}
            {uiToast && (
                <div className={`fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ${uiToast.type === 'success'
                    ? 'bg-green-500 text-white'
                    : 'bg-red-500 text-white'
                    }`}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{uiToast.message}</span>
                        <button
                            onClick={() => setUiToast(null)}
                            className="ml-3 text-white hover:text-gray-200 text-lg font-bold"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// Removed local Timeline (now imported)

/* Removed local SessionTable (now imported)
function SessionTable({ sessions }: { sessions: Session[] }) {
    const [openId, setOpenId] = useState<string | null>(null)
    return (
        <div className="card">
            <table className="w-full border-collapse">
                <thead>
                    <tr>
                        <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Date/Time</th>
                        <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Session</th>
                        <th colSpan={3} className="border-b border-app-border py-1 text-center text-xs text-app-muted align-bottom">Data access</th>
                        <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Risk</th>
                        <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Tool calls</th>
                        <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom"></th>
                    </tr>
                    <tr>
                        <th className="border-b border-app-border py-1 text-left">Private</th>
                        <th className="border-b border-app-border py-1 text-left">Untrusted</th>
                        <th className="border-b border-app-border py-1 text-left">External</th>
                    </tr>
                </thead>
                <tbody>
                    {sessions.map((s) => {
                        const isOpen = openId === s.session_id
                        const firstTs = s.tool_calls[0]?.timestamp
                        const sec = getSecurityFlags(s.data_access_summary as any)
                        return (
                            <React.Fragment key={s.session_id}>
                                <tr className={isOpen ? 'bg-app-bg/30' : ''}>
                                    <td className="border-b border-app-border py-2 whitespace-nowrap">{firstTs ? formatDate(firstTs) : 'Unknown'}</td>
                                    <td className="border-b border-app-border py-2 max-w-[260px]">
                                        <div className="truncate" title={s.session_id}>{shortenMiddle(s.session_id, 6, 4)}</div>
                                        <div className="text-xs text-app-muted truncate" title={`Correlation: ${s.correlation_id}`}>{shortenMiddle(s.correlation_id, 4, 4)}</div>
                                    </td>
                                    <td className="border-b border-app-border py-2">
                                        <span className={`inline-block w-2 h-2 rounded-full ${sec.privateData ? 'bg-blue-400' : 'bg-app-border'}`} title={sec.privateData ? 'Private data access' : 'No private data access'} />
                                    </td>
                                    <td className="border-b border-app-border py-2">
                                        <span className={`inline-block w-2 h-2 rounded-full ${sec.untrusted ? 'bg-amber-400' : 'bg-app-border'}`} title={sec.untrusted ? 'Untrusted content exposure' : 'No untrusted exposure'} />
                                    </td>
                                    <td className="border-b border-app-border py-2">
                                        <span className={`inline-block w-2 h-2 rounded-full ${sec.external ? 'bg-rose-400' : 'bg-app-border'}`} title={sec.external ? 'External communication' : 'No external communication'} />
                                    </td>
                                    <td className="border-b border-app-border py-2">
                                        {(() => { const r = riskLevel(sec); return <span className={r.colorClass}>{r.label}</span> })()}
                                    </td>
                                    <td className="border-b border-app-border py-2">{s.tool_calls.length}</td>
                                    <td className="border-b border-app-border py-2">
                                        <button className="button" onClick={() => setOpenId(isOpen ? null : s.session_id)}>
                                            {isOpen ? 'Hide' : 'Show'}
                                        </button>
                                    </td>
                                </tr>
                                {isOpen && (
                                    <tr>
                                        <td colSpan={8} className="py-3">
                                            <div style={{ overflowX: 'auto' }}>
                                                <div className="mb-3 flex flex-wrap gap-2">
                                                    <span className="text-xs text-app-muted">Security:</span>
                                                    {sec.privateData && (
                                                        <span className="inline-flex items-center text-xs border border-blue-400/30 text-blue-400 rounded-full px-2 py-0.5">Private data access</span>
                                                    )}
                                                    {sec.untrusted && (
                                                        <span className="inline-flex items-center text-xs border border-amber-400/30 text-amber-400 rounded-full px-2 py-0.5">Untrusted content</span>
                                                    )}
                                                    {sec.external && (
                                                        <span className="inline-flex items-center text-xs border border-rose-400/30 text-rose-400 rounded-full px-2 py-0.5">External comms</span>
                                                    )}
                                                    {!sec.privateData && !sec.untrusted && !sec.external && (
                                                        <span className="inline-flex items-center text-xs border border-app-border text-app-muted rounded-full px-2 py-0.5">None</span>
                                                    )}
                                                </div>
                                                {s.tool_calls.length > 0 && (
                                                    <table className="w-full border-collapse">
                                                        <thead>
                                                            <tr>
                                                                <th className="border-b border-app-border py-2 text-left">Time</th>
                                                                <th className="border-b border-app-border py-2 text-left">Tool</th>
                                                                <th className="border-b border-app-border py-2 text-left">Status</th>
                                                                <th className="border-b border-app-border py-2 text-left">Duration (ms)</th>
                                                                <th className="border-b border-app-border py-2 text-left min-w-[240px]">Parameters</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {s.tool_calls.map((tc) => (
                                                                <tr key={tc.id}>
                                                                    <td className="border-b border-app-border py-2 whitespace-nowrap">{formatDate(tc.timestamp)}</td>
                                                                    <td className="border-b border-app-border py-2">{tc.tool_name}</td>
                                                                    <td className="border-b border-app-border py-2">{tc.status ?? 'pending'}</td>
                                                                    <td className="border-b border-app-border py-2">{tc.duration_ms ?? ''}</td>
                                                                    <td className="border-b border-app-border py-2 text-xs font-mono">
                                                                        <code className="text-xs">{JSON.stringify(tc.parameters ?? {}, null, 0)}</code>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}

                                                {Object.keys(s.data_access_summary ?? {}).length > 0 && (
                                                    <details className="mt-3">
                                                        <summary className="cursor-pointer">Data access summary</summary>
                                                        <pre style={{
                                                            background: 'var(--bg)',
                                                            border: '1px solid var(--border)',
                                                            borderRadius: 8,
                                                            padding: 12,
                                                            overflow: 'auto',
                                                            fontSize: 12,
                                                        }}>{JSON.stringify(s.data_access_summary, null, 2)}</pre>
                                                    </details>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
*/

function JsonEditors({ projectRoot }: { projectRoot: string }) {
    const files = useMemo(() => (
        [
            {
                key: 'config',
                name: 'config.json',
                path: `${projectRoot}/config.json`,
                description:
                    'Global configuration for Open Edison. Defines server host/port, API key, logging level, and the list of MCP servers (name, command, args, env, enabled). Changes affect server behavior across the app.'
            },
            {
                key: 'tool',
                name: 'tool_permissions.json',
                path: `${projectRoot}/tool_permissions.json`,
                description:
                    'Fine-grained tool permissions. Controls which tools can be invoked, optional allow/deny lists, and classification flags (e.g., read private data, write operation, external communication). Used by the session tracker and policy checks.'
            },
            {
                key: 'resource',
                name: 'resource_permissions.json',
                path: `${projectRoot}/resource_permissions.json`,
                description:
                    'Resource access policy. Maps resource identifiers (files, endpoints, secrets) to allowed operations and visibility. Used to determine untrusted/public vs private data access.'
            },
            {
                key: 'prompt',
                name: 'prompt_permissions.json',
                path: `${projectRoot}/prompt_permissions.json`,
                description:
                    'Prompt/library access policy. Governs which predefined prompts can be loaded or executed and with what constraints. Useful for reducing prompt injection or limiting sensitive prompts.'
            },
        ] as const
    ), [projectRoot])

    type FileKey = typeof files[number]['key']
    const [active, setActive] = useState<FileKey>('config')
    const [content, setContent] = useState<Record<FileKey, string>>({} as any)
    const [error, setError] = useState<string>('')
    const [statusMsg, setStatusMsg] = useState<string>('')
    const [loadingKey, setLoadingKey] = useState<FileKey | null>(null)

    useEffect(() => {
        const f = files.find(f => f.key === active)
        if (!f) return
        if (content[active] !== undefined) return
        const load = async () => {
            try {
                setLoadingKey(active)
                const resp = await fetch(`/@fs${f.path}`)
                if (!resp.ok) throw new Error(`Cannot read ${f.name}`)
                const txt = await resp.text()
                setContent(prev => ({ ...prev, [active]: txt }))
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load file')
            } finally {
                setLoadingKey(null)
            }
        }
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active])

    // Monaco provides JSON diagnostics; explicit validate/format omitted for simplicity

    const download = () => {
        const file = files.find(f => f.key === active)!
        const blob = new Blob([content[active] ?? ''], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = file.name
        a.click()
        URL.revokeObjectURL(a.href)
    }

    const saveToDisk = async () => {
        try {
            const file = files.find(f => f.key === active)!
            // Attempt to POST to a local helper endpoint. If none running, inform the user.
            const resp = await fetch('/__save_json__', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: file.path, content: content[active] ?? '' })
            })
            if (!resp.ok) throw new Error('Local save helper not running or error saving')

            // Clear permission caches after successful save (only for permission files)
            if (file.key === 'tool' || file.key === 'resource' || file.key === 'prompt') {
                console.log(`🔄 Clearing permission caches after ${file.name} save...`)
                try {
                    // Load config to get server settings
                    const configResponse = await fetch('/config.json')
                    if (configResponse.ok) {
                        const configData = await configResponse.json()
                        const serverHost = configData?.server?.host || 'localhost'
                        const serverPort = (configData?.server?.port || 3000) + 1 // API runs on port + 1
                        const cacheResponse = await fetch(`http://${serverHost}:${serverPort}/api/clear-caches`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        })
                        if (cacheResponse.ok) {
                            const cacheResult = await cacheResponse.json()
                            console.log('✅ Cache invalidation successful:', cacheResult)
                        } else {
                            console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheResponse.status)
                        }
                    } else {
                        console.warn('⚠️ Could not load config.json to determine server port')
                    }
                } catch (cacheError) {
                    console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheError)
                }
            }

            setStatusMsg('Saved')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save. You can use Download to save manually.')
            setStatusMsg('')
        }
    }

    const file = files.find(f => f.key === active)!
    const val = content[active] ?? (loadingKey === active ? '// Loading…' : '')

    return (
        <div className="card">
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
                {/* File list */}
                <div className="border border-app-border rounded p-2 h-[580px] overflow-y-auto bg-app-bg/50">
                    <div className="text-xs text-app-muted px-2 pb-2">Files</div>
                    <ul className="space-y-1">
                        {files.map(f => {
                            const selected = active === f.key
                            return (
                                <li key={f.key}>
                                    <button
                                        className={`w-full text-left px-3 py-2 rounded border transition-colors ${selected ? 'border-app-accent text-app-accent bg-app-accent/10' : 'border-app-border text-app-text hover:bg-app-border/20'}`}
                                        onClick={() => setActive(f.key)}
                                        title={f.path}
                                    >
                                        <div className="text-sm font-medium truncate">{f.name}</div>
                                        <div className="text-[10px] text-app-muted truncate">{f.path.replace(projectRoot, '') || f.path}</div>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </div>

                {/* Editor */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-sm text-app-muted">Editing: <span className="text-app-text">{file.name}</span></div>
                        <div className="flex gap-2 items-center">
                            <button className="button" onClick={saveToDisk}>Save</button>
                            <button className="button" onClick={download}>Download</button>
                            {statusMsg && <span className="text-xs text-app-muted">{statusMsg}</span>}
                        </div>
                    </div>
                    {error && <div className="text-rose-400 text-sm mb-2">{error}</div>}
                    <div className="border border-app-border rounded overflow-hidden">
                        <Editor
                            height="520px"
                            defaultLanguage="json"
                            language="json"
                            theme="vs-dark"
                            options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', scrollBeyondLastLine: false }}
                            value={val}
                            onChange={(value) => setContent(prev => ({ ...prev, [active]: value ?? '' }))}
                        />
                    </div>
                    <div className="text-xs text-app-muted mt-2">Read-only viewer (no direct disk writes). Use Download or Save to persist changes.</div>
                    <div className="mt-3 border border-app-border rounded p-3 bg-app-bg/50">
                        <div className="text-sm font-semibold mb-1">About this file</div>
                        <p className="text-xs text-app-muted whitespace-pre-wrap">{file.description}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}



// Removed local Toggle (now imported)

function ConfigurationManager({ projectRoot }: { projectRoot: string }) {
    type MCPServerDefault = {
        name: string
        tools?: Record<string, PermissionFlags>
        resources?: Record<string, PermissionFlags>
        prompts?: Record<string, PermissionFlags>
    }
    type ConfigFile = {
        server: { host: string; port: number; api_key?: string }
        logging?: Record<string, unknown>
        mcp_servers: Array<{
            name: string
            command: string
            args?: string[]
            env?: Record<string, string>
            enabled?: boolean
            roots?: string[]
        }>
        'edison-watch-api-key'?: string
    }
    type PermissionFlags = {
        enabled: boolean
        write_operation: boolean
        read_private_data: boolean
        read_untrusted_public_data: boolean
        description?: string
    }
    type ToolPerms = Record<string, Record<string, PermissionFlags>> & { _metadata?: unknown }
    type ResourcePerms = Record<string, Record<string, PermissionFlags>> & { _metadata?: unknown }
    type PromptPerms = Record<string, Record<string, PermissionFlags>> & { _metadata?: unknown }

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>('')
    const [defaults, setDefaults] = useState<MCPServerDefault[]>([])
    const [config, setConfig] = useState<ConfigFile | null>(null)
    const [toolPerms, setToolPerms] = useState<ToolPerms | null>(null)
    const [resourcePerms, setResourcePerms] = useState<ResourcePerms | null>(null)
    const [promptPerms, setPromptPerms] = useState<PromptPerms | null>(null)
    const [saving, setSaving] = useState(false)
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [viewMode, setViewMode] = useState<'section' | 'tiles'>('section')
    
    // OAuth state
    const [oauthInfo, setOauthInfo] = useState<Record<string, OAuthServerInfo>>({})
    const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({})
    const [oauthError, setOauthError] = useState<Record<string, string>>({})

    // Auto-dismiss toast after 10 seconds
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => {
                setToast(null)
            }, 10000) // 10 seconds

            return () => clearTimeout(timer)
        }
    }, [toast])
    const [selectedServer, setSelectedServer] = useState<string | null>(null)
    const [validateInProgress, setValidateInProgress] = useState<string | null>(null)
    const [validateErrors, setValidateErrors] = useState<Record<string, string>>({})
    const [apiKeyVisible, setApiKeyVisible] = useState(false)
    const [apiKeyInput, setApiKeyInput] = useState<string>('')
    const [savingKey, setSavingKey] = useState(false)

    // Persist view mode across reloads
    useEffect(() => {
        try {
            const saved = localStorage.getItem('cm_view_mode')
            if (saved === 'section' || saved === 'tiles') setViewMode(saved)
        } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useEffect(() => {
        try { localStorage.setItem('cm_view_mode', viewMode) } catch { /* ignore */ }
    }, [viewMode])
    useEffect(() => {
        const k = (config as any)?.['edison-watch-api-key'] || ''
        setApiKeyInput(k)
    }, [config])
    // Baselines for Save only changes
    const [origConfig, setOrigConfig] = useState<ConfigFile | null>(null)
    const [origToolPerms, setOrigToolPerms] = useState<ToolPerms | null>(null)
    const [origResourcePerms, setOrigResourcePerms] = useState<ResourcePerms | null>(null)
    const [origPromptPerms, setOrigPromptPerms] = useState<PromptPerms | null>(null)

    const CONFIG_NAME = `config.json`
    const TOOL_NAME = `tool_permissions.json`
    const RESOURCE_NAME = `resource_permissions.json`
    const PROMPT_NAME = `prompt_permissions.json`

    useEffect(() => {
        let active = true
        const loadAll = async () => {
            setLoading(true)
            setError('')
            try {
                const [c, t, r, p] = await Promise.all([
                    fetch(`/@fs${projectRoot}/${CONFIG_NAME}`),
                    fetch(`/@fs${projectRoot}/${TOOL_NAME}`),
                    fetch(`/@fs${projectRoot}/${RESOURCE_NAME}`),
                    fetch(`/@fs${projectRoot}/${PROMPT_NAME}`),
                ])
                if (!c.ok) throw new Error('Failed to load config.json')
                if (!t.ok) throw new Error('Failed to load tool_permissions.json')
                if (!r.ok) throw new Error('Failed to load resource_permissions.json')
                if (!p.ok) throw new Error('Failed to load prompt_permissions.json')
                const cJson = await c.json()
                const tJson = await t.json()
                const rJson = await r.json()
                const pJson = await p.json()
                if (!active) return
                // Derive server defaults prioritizing config.json servers, then add extras from permissions
                const configServers: string[] = Array.isArray((cJson as any)?.mcp_servers)
                    ? ((cJson as any).mcp_servers as Array<{ name: string }>).map((s) => String(s.name || '').trim())
                    : []
                const keysFrom = (obj: any) => Object.keys(obj || {}).filter((k) => k !== '_metadata' && k !== 'builtin')
                const permNames = new Set<string>([
                    ...keysFrom(tJson),
                    ...keysFrom(rJson),
                    ...keysFrom(pJson),
                ].map((n) => String(n || '').trim()))

                // Start with config servers, in declared order
                const defsOrdered: MCPServerDefault[] = configServers.map((name) => ({
                    name,
                    tools: (tJson as any)?.[name],
                    resources: (rJson as any)?.[name],
                    prompts: (pJson as any)?.[name],
                }))
                // Append permission-only servers not present in config
                for (const extra of Array.from(permNames)) {
                    if (!configServers.map((n) => n.toLowerCase()).includes(extra.toLowerCase())) {
                        defsOrdered.push({
                            name: extra,
                            tools: (tJson as any)?.[extra],
                            resources: (rJson as any)?.[extra],
                            prompts: (pJson as any)?.[extra],
                        })
                    }
                }
                const defs: MCPServerDefault[] = defsOrdered
                setDefaults(defs)
                setConfig(cJson as ConfigFile)
                setOrigConfig(cJson as ConfigFile)
                setToolPerms(tJson as ToolPerms)
                setResourcePerms(rJson as ResourcePerms)
                setPromptPerms(pJson as PromptPerms)
                setOrigToolPerms(tJson as ToolPerms)
                setOrigResourcePerms(rJson as ResourcePerms)
                setOrigPromptPerms(pJson as PromptPerms)
            } catch (e) {
                if (!active) return
                setError(e instanceof Error ? e.message : 'Failed to load data')
            } finally {
                if (active) setLoading(false)
            }
        }
        void loadAll()
        return () => { active = false }
    }, [projectRoot])

    // Removed mergePermsFromDefaults: permission files are the source of truth now

    function buildConfigSaveObject(original: ConfigFile, current: ConfigFile): ConfigFile {
        // Start from original and update only changed/new servers
        const originalServers = original.mcp_servers || []
        const currentServers = current.mcp_servers || []
        const resultServers = originalServers.map(s => ({ ...s }))
        for (const cur of currentServers) {
            const idx = resultServers.findIndex(s => s.name === cur.name)
            if (idx === -1) {
                resultServers.push(cur)
            } else {
                const orig = resultServers[idx]!
                if (!shallowEqualServer(orig, cur)) {
                    resultServers[idx] = cur
                }
            }
        }
        const result: ConfigFile = { ...original, mcp_servers: resultServers }
        const currExtKey = (current as any)?.['edison-watch-api-key']
        const origExtKey = (original as any)?.['edison-watch-api-key']
        if (currExtKey !== origExtKey) {
            (result as any)['edison-watch-api-key'] = currExtKey
        }
        return result
    }

    function shallowEqualServer(a: ConfigFile['mcp_servers'][number], b: ConfigFile['mcp_servers'][number]): boolean {
        const envA = a.env || {}
        const envB = b.env || {}
        const argsA = a.args || []
        const argsB = b.args || []
        return a.name === b.name
            && a.command === b.command
            && JSON.stringify(argsA) === JSON.stringify(argsB)
            && JSON.stringify(envA) === JSON.stringify(envB)
            && Boolean(a.enabled) === Boolean(b.enabled)
    }

    function buildPermsSaveObject<T extends Record<string, any>>(
        original: T,
        currentMerged: T,
        defs: MCPServerDefault[],
        kind: 'tools' | 'resources' | 'prompts'
    ): T {
        const result: any = deepClone(original)
        const defaultsByServer: Record<string, Record<string, PermissionFlags>> = {}
        for (const d of defs) {
            const entries = (d as any)[kind] as Record<string, PermissionFlags> | undefined
            if (entries) defaultsByServer[d.name] = entries
        }

        // Persist only core permission flags; drop any UI metadata like description/acl
        const toCore = (f: any) => ({
            enabled: Boolean(f?.enabled),
            write_operation: Boolean(f?.write_operation),
            read_private_data: Boolean(f?.read_private_data),
            read_untrusted_public_data: Boolean(f?.read_untrusted_public_data),
        })

        for (const [group, items] of Object.entries(currentMerged as any)) {
            if (group === '_metadata') continue
            for (const [item, flags] of Object.entries(items as any)) {
                const origGroup = (original as any)[group] || {}
                const hadInOrig = Object.prototype.hasOwnProperty.call(origGroup, item)
                const baseline: PermissionFlags | undefined = hadInOrig
                    ? (origGroup as any)[item]
                    : defaultsByServer[group]?.[item]
                if (!baseline) {
                    const shouldAdd = Boolean((flags as PermissionFlags).enabled)
                        || Boolean((flags as any).write_operation)
                        || Boolean((flags as any).read_private_data)
                        || Boolean((flags as any).read_untrusted_public_data)
                    if (shouldAdd) {
                        if (!result[group]) result[group] = {}
                        result[group][item] = toCore(flags)
                    }
                } else if (!shallowEqualPerms(flags as PermissionFlags, baseline)) {
                    if (!result[group]) result[group] = {}
                    result[group][item] = toCore(flags)
                }
            }
        }
        return result
    }

    function shallowEqualPerms(a: PermissionFlags, b: PermissionFlags): boolean {
        return Boolean(a?.enabled) === Boolean(b?.enabled)
            && Boolean(a?.write_operation) === Boolean(b?.write_operation)
            && Boolean(a?.read_private_data) === Boolean(b?.read_private_data)
            && Boolean(a?.read_untrusted_public_data) === Boolean(b?.read_untrusted_public_data)
    }

    function deepClone<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj))
    }

    const upsertServer = (srvName: string, updater: (existing: ConfigFile['mcp_servers'][number] | undefined, def?: MCPServerDefault) => ConfigFile['mcp_servers'][number]) => {
        if (!config) return
        const currentList = config.mcp_servers || []
        const idx = currentList.findIndex(s => s.name === srvName)
        const def = defaults.find(d => d.name === srvName)
        const updated = updater(currentList[idx], def)
        let nextList = [...currentList]
        if (idx === -1) nextList.push(updated)
        else nextList[idx] = updated
        setConfig({ ...config, mcp_servers: nextList })
    }

    const toggleServer = (srvName: string, enabled: boolean) => {
        upsertServer(srvName, (existing) => ({
            name: srvName,
            command: existing?.command ?? '',
            args: existing?.args ?? [],
            env: existing?.env ?? {},
            enabled,
            roots: existing?.roots ?? [],
        }))
    }

    // Removed setServerApiKey: API key defaults are no longer provided here

    const saveAll = async (onlyChanges: boolean) => {
        setSaving(true)
        setToast(null)
        try {
            const post = (name: string, content: string) => fetch('/__save_json__', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content })
            })
            const cfgToSave = onlyChanges && origConfig && config
                ? buildConfigSaveObject(origConfig, config)
                : config
            const toolsToSave = onlyChanges && toolPerms && origToolPerms
                ? buildPermsSaveObject(origToolPerms, toolPerms, defaults, 'tools')
                : toolPerms
            const resourcesToSave = onlyChanges && resourcePerms && origResourcePerms
                ? buildPermsSaveObject(origResourcePerms, resourcePerms, defaults, 'resources')
                : resourcePerms
            const promptsToSave = onlyChanges && promptPerms && origPromptPerms
                ? buildPermsSaveObject(origPromptPerms, promptPerms, defaults, 'prompts')
                : promptPerms
            const responses = await Promise.all([
                post(CONFIG_NAME, JSON.stringify(cfgToSave, null, 4)),
                post(TOOL_NAME, JSON.stringify(toolsToSave, null, 4)),
                post(RESOURCE_NAME, JSON.stringify(resourcesToSave, null, 4)),
                post(PROMPT_NAME, JSON.stringify(promptsToSave, null, 4)),
            ])
            const notOk = responses.find(r => !r.ok)
            if (notOk) throw new Error('One or more files failed to save')

            // Clear permission caches after successful save
            console.log('🔄 Clearing permission caches after configuration save...')
            try {
                // Get server config from the loaded config
                const serverHost = config?.server?.host || 'localhost'
                const serverPort = (config?.server?.port || 3000) + 1 // API runs on port + 1
                const cacheResponse = await fetch(`http://${serverHost}:${serverPort}/api/clear-caches`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                if (cacheResponse.ok) {
                    const cacheResult = await cacheResponse.json()
                    console.log('✅ Cache invalidation successful:', cacheResult)
                } else {
                    console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheResponse.status)
                }
            } catch (cacheError) {
                console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheError)
            }

            setToast({ message: onlyChanges ? 'Saved changes' : 'Saved', type: 'success' })
        } catch (e) {
            setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

    const reinitializeServers = async () => {
        setSaving(true)
        setToast(null)
        try {
            // Step 1: Save configuration changes first
            console.log('🔄 Saving configuration changes...')
            const post = (name: string, content: string) => fetch('/__save_json__', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content })
            })

            const cfgToSave = origConfig && config
                ? buildConfigSaveObject(origConfig, config)
                : config
            const toolsToSave = toolPerms && origToolPerms
                ? buildPermsSaveObject(origToolPerms, toolPerms, defaults, 'tools')
                : toolPerms
            const resourcesToSave = resourcePerms && origResourcePerms
                ? buildPermsSaveObject(origResourcePerms, resourcePerms, defaults, 'resources')
                : resourcePerms
            const promptsToSave = promptPerms && origPromptPerms
                ? buildPermsSaveObject(origPromptPerms, promptPerms, defaults, 'prompts')
                : promptPerms

            const responses = await Promise.all([
                post(CONFIG_NAME, JSON.stringify(cfgToSave, null, 4)),
                post(TOOL_NAME, JSON.stringify(toolsToSave, null, 4)),
                post(RESOURCE_NAME, JSON.stringify(resourcesToSave, null, 4)),
                post(PROMPT_NAME, JSON.stringify(promptsToSave, null, 4)),
            ])

            const notOk = responses.find(r => !r.ok)
            if (notOk) throw new Error('One or more files failed to save')

            console.log('✅ Configuration saved successfully')

            // Step 2: Clear permission caches
            console.log('🔄 Clearing permission caches...')
            try {
                const serverHost = config?.server?.host || 'localhost'
                const serverPort = (config?.server?.port || 3000) + 1 // API runs on port + 1
                const cacheResponse = await fetch(`http://${serverHost}:${serverPort}/api/clear-caches`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                if (cacheResponse.ok) {
                    const cacheResult = await cacheResponse.json()
                    console.log('✅ Cache invalidation successful:', cacheResult)
                } else {
                    console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheResponse.status)
                }
            } catch (cacheError) {
                console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheError)
            }

            // Step 3: Reinitialize MCP servers
            console.log('🔄 Reinitializing MCP servers...')
            const serverHost = config?.server?.host || 'localhost'
            const serverPort = (config?.server?.port || 3000) + 1 // API runs on port + 1
            const apiKey = config?.server?.api_key || ''

            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`
            }

            const reinitResponse = await fetch(`http://${serverHost}:${serverPort}/mcp/reinitialize`, {
                method: 'POST',
                headers
            })

            if (!reinitResponse.ok) {
                const errorData = await reinitResponse.json().catch(() => ({}))
                throw new Error(errorData.message || `Reinitialize failed (${reinitResponse.status})`)
            }

            const result = await reinitResponse.json()
            console.log('✅ MCP servers reinitialized successfully:', result)
            setToast({ message: `Saved and reinitialized ${result.total_final_mounted || 0} servers`, type: 'success' })
<<<<<<< HEAD

=======
            
            // Refresh OAuth status after successful reinitialization
            console.log('🔐 Refreshing OAuth status after reinitialization...')
            await loadOAuthStatus()
            
>>>>>>> origin/main
        } catch (e) {
            console.error('❌ Failed to save and reinitialize:', e)
            setToast({ message: e instanceof Error ? e.message : 'Save and reinitialize failed', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

    async function validateAndImport(serverName: string) {
        setToast(null)
        setValidateInProgress(serverName)
        try {
            const cfg = (config?.mcp_servers || []).find(s => (s.name || '').trim().toLowerCase() === serverName.toLowerCase())
            if (!cfg) throw new Error('Server not found in config.json')
            const body = {
                name: cfg.name,
                command: cfg.command || '',
                args: Array.isArray(cfg.args) ? cfg.args : [],
                env: cfg.env || {},
                roots: Array.isArray(cfg.roots) ? cfg.roots : undefined,
                timeout_s: 20,
            }
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = (() => { try { return localStorage.getItem('api_key') || '' } catch { return '' } })()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
            const resp = await fetch('/mcp/validate', { method: 'POST', headers, body: JSON.stringify(body) })
            const data = await resp.json() as any
            if (!resp.ok || data?.valid === false) {
                const msg = (data && typeof data.error === 'string') ? data.error : `Validate failed (${resp.status})`
                throw new Error(msg)
            }

            const toPerm = (desc?: string): PermissionFlags => ({ enabled: false, write_operation: false, read_private_data: false, read_untrusted_public_data: false, description: desc, acl: 'PUBLIC' } as PermissionFlags)

            setToolPerms(prev => {
                const next = { ...(prev || {}) } as any
                const server = next[serverName] || {}
                for (const t of data.tools || []) { if (!server[t.name]) server[t.name] = toPerm(t.description) }
                next[serverName] = server
                return next
            })
            setResourcePerms(prev => {
                const next = { ...(prev || {}) } as any
                const server = next[serverName] || {}
                for (const r of data.resources || []) { const key = r.uri; if (!server[key]) server[key] = toPerm(r.description) }
                next[serverName] = server
                return next
            })
            setPromptPerms(prev => {
                const next = { ...(prev || {}) } as any
                const server = next[serverName] || {}
                for (const p of data.prompts || []) { if (!server[p.name]) server[p.name] = toPerm(p.description) }
                next[serverName] = server
                return next
            })
            setToast({ message: 'Imported initial permissions from validation (not yet saved)', type: 'success' })
            setValidateErrors(prev => { const next = { ...prev }; delete next[serverName]; return next })
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Validation failed'
            setValidateErrors(prev => ({ ...prev, [serverName]: msg }))
        } finally {
            setValidateInProgress(null)
        }
    }

    async function quickStart(serverName: string) {
        await validateAndImport(serverName)
        toggleServer(serverName, true)
        setToast({ message: 'Quick-start: imported permissions and enabled (not yet saved)', type: 'success' })
    }

    const AUTOCONFIG_URL = (globalThis as any).__AUTOCONFIG_URL__ || 'https://api.edison.watch/api/config-perms'// 'http://localhost:3101/api/config-perms'

    function getNamesForServer<T extends Record<string, any> | null | undefined>(data: T, serverName: string): string[] {
        if (!data) return []
        const group = (data as any)[serverName] || {}
        return Object.keys(group).filter((k) => k !== '_metadata')
    }

    function unprefixByServer(name: string, serverName: string): string {
        const prefix = `${serverName}_`
        return name.toLowerCase().startsWith(prefix.toLowerCase())
            ? name.slice(prefix.length)
            : name
    }

    async function autoConfigure(serverName: string) {
        try {
            const tools = getNamesForServer(toolPerms, serverName)
            const resources = getNamesForServer(resourcePerms, serverName)
            const prompts = getNamesForServer(promptPerms, serverName)

            if (tools.length === 0 && resources.length === 0 && prompts.length === 0) {
                setToast({ message: 'No known tools/resources/prompts for this server', type: 'error' })
                return
            }

            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const externalKey = (config as any)?.['edison-watch-api-key'] || ''
            if (externalKey) headers['X-API-KEY'] = externalKey

            const body = {
                server: serverName,
                // Unprefix tools and prompts by server name for backend autoconfig
                tools: tools.map((n) => unprefixByServer(n, serverName)),
                resources,
                prompts: prompts.map((n) => unprefixByServer(n, serverName)),
            }
            const resp = await fetch(AUTOCONFIG_URL, { method: 'POST', headers, body: JSON.stringify(body), mode: 'cors' })
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '')
                setToast({ message: `Autoconfig failed (${resp.status})${txt ? ` - ${txt}` : ''}`, type: 'error' })
                return
            }
            let payload: any = null
            try { payload = await resp.json() } catch { /* ignore */ }
            if (!payload) {
                setToast({ message: 'Autoconfig succeeded (no payload)', type: 'success' })
                return
            }

            const toolsResp = payload.tools as Record<string, any> | undefined
            const resourcesResp = payload.resources as Record<string, any> | undefined
            const promptsResp = payload.prompts as Record<string, any> | undefined

            if (toolsResp) {
                setToolPerms(prev => {
                    const next = { ...(prev || {}) } as any
                    const server = { ...(next[serverName] || {}) }
                    for (const [name, flags] of Object.entries(toolsResp)) {
                        const prefixed = `${serverName}_${name}`
                        const targetKey = Object.prototype.hasOwnProperty.call(server, prefixed) ? prefixed : name
                        server[targetKey] = flags
                    }
                    next[serverName] = server
                    return next
                })
            }
            if (resourcesResp) {
                setResourcePerms(prev => {
                    const next = { ...(prev || {}) } as any
                    const server = { ...(next[serverName] || {}) }
                    for (const [name, flags] of Object.entries(resourcesResp)) {
                        server[name] = flags
                    }
                    next[serverName] = server
                    return next
                })
            }
            if (promptsResp) {
                setPromptPerms(prev => {
                    const next = { ...(prev || {}) } as any
                    const server = { ...(next[serverName] || {}) }
                    for (const [name, flags] of Object.entries(promptsResp)) {
                        const prefixed = `${serverName}_${name}`
                        const targetKey = Object.prototype.hasOwnProperty.call(server, prefixed) ? prefixed : name
                        server[targetKey] = flags
                    }
                    next[serverName] = server
                    return next
                })
            }

            setToast({ message: 'Autoconfig applied (not yet saved)', type: 'success' })
        } catch (e) {
            console.warn('Autoconfig request error:', e)
            setToast({ message: 'Autoconfig failed', type: 'error' })
        }
    }

    const saveExternalApiKey = async () => {
        if (!config) return
        setSavingKey(true)
        try {
            const nextCfg: any = { ...config, ['edison-watch-api-key']: apiKeyInput }
            const resp = await fetch('/__save_json__', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'config.json', content: JSON.stringify(nextCfg, null, 4) })
            })
            if (!resp.ok) throw new Error('Save failed')
            setConfig(nextCfg)
            setOrigConfig(nextCfg)
            setToast({ message: 'API key saved', type: 'success' })
        } catch (e) {
            setToast({ message: 'Failed to save API key', type: 'error' })
        } finally {
            setSavingKey(false)
        }
    }

    // OAuth functions
    const loadOAuthStatus = async () => {
        if (!config) return
        
        try {
            const serverHost = config.server.host || 'localhost'
            const serverPort = (config.server.port || 3000) + 1
            const apiKey = config.server.api_key || ''
            
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
            
            const response = await fetch(`http://${serverHost}:${serverPort}/mcp/oauth/status`, {
                method: 'GET',
                headers
            })
            
            if (response.ok) {
                const data: OAuthStatusResponse = await response.json()
                setOauthInfo(data.oauth_status)
            }
        } catch (error) {
            console.warn('Failed to load OAuth status:', error)
        }
    }

    const testConnection = async (serverName: string) => {
        if (!config) return
        
        setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: true }))
        setOauthError((prev: Record<string, string>) => {
            const next = { ...prev }
            delete next[serverName]
            return next
        })
        
        try {
            const serverHost = config.server.host || 'localhost'
            const serverPort = (config.server.port || 3000) + 1
            const apiKey = config.server.api_key || ''
            
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
            
            const body: OAuthAuthorizeRequest = {
                // Use server-specific OAuth configuration if available
            }
            
            const response = await fetch(`http://${serverHost}:${serverPort}/mcp/oauth/test-connection/${serverName}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            })
            
            if (response.ok) {
                const data = await response.json()
                setToast({ message: data.message, type: 'success' })
                
                // Refresh OAuth status after successful connection test
                setTimeout(loadOAuthStatus, 1000)
            } else {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `Connection test failed (${response.status})`)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Connection test failed'
            setOauthError((prev: Record<string, string>) => ({ ...prev, [serverName]: message }))
            setToast({ message, type: 'error' })
        } finally {
            setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: false }))
        }
    }

    const clearServerTokens = async (serverName: string) => {
        if (!config) return
        
        setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: true }))
        
        try {
            const serverHost = config.server.host || 'localhost'
            const serverPort = (config.server.port || 3000) + 1
            const apiKey = config.server.api_key || ''
            
            const headers: Record<string, string> = {
                'Authorization': `Bearer ${apiKey}`
            }
            
            const response = await fetch(`http://${serverHost}:${serverPort}/mcp/oauth/tokens/${serverName}`, {
                method: 'DELETE',
                headers
            })
            
            if (response.ok) {
                const data = await response.json()
                setToast({ message: data.message, type: 'success' })
                
                // Update OAuth info immediately
                setOauthInfo((prev: Record<string, OAuthServerInfo>) => ({
                    ...prev,
                    [serverName]: {
                        server_name: serverName,
                        status: 'needs_auth' as OAuthStatus,
                        has_refresh_token: false,
                        token_expires_at: null,
                        ...prev[serverName]
                    }
                }))
            } else {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `Failed to clear tokens (${response.status})`)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to clear tokens'
            setToast({ message, type: 'error' })
        } finally {
            setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: false }))
        }
    }

    const refreshServerOAuth = async (serverName: string) => {
        if (!config) return
        
        setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: true }))
        
        try {
            const serverHost = config.server.host || 'localhost'
            const serverPort = (config.server.port || 3000) + 1
            const apiKey = config.server.api_key || ''
            
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
            
            const response = await fetch(`http://${serverHost}:${serverPort}/mcp/oauth/refresh/${serverName}`, {
                method: 'POST',
                headers
            })
            
            if (response.ok) {
                const data = await response.json()
                setOauthInfo((prev: Record<string, OAuthServerInfo>) => ({
                    ...prev,
                    [serverName]: {
                        server_name: serverName,
                        status: data.oauth_status,
                        error_message: data.error_message,
                        has_refresh_token: data.has_refresh_token,
                        token_expires_at: data.token_expires_at,
                        scopes: data.scopes
                    }
                }))
                setToast({ message: 'OAuth status refreshed', type: 'success' })
            } else {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.detail || `Failed to refresh status (${response.status})`)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to refresh OAuth status'
            setToast({ message, type: 'error' })
        } finally {
            setOauthLoading((prev: Record<string, boolean>) => ({ ...prev, [serverName]: false }))
        }
    }

    // Helper function to determine if a server is remote (may need OAuth)
    const isRemoteServer = (serverConfig: any): boolean => {
        return (
            serverConfig.command === 'npx' &&
            serverConfig.args?.length >= 3 &&
            serverConfig.args[1] === 'mcp-remote' &&
            serverConfig.args[2]?.startsWith('https://')
        )
    }

    // Load OAuth status when config is loaded
    useEffect(() => {
        if (config && !loading) {
            loadOAuthStatus()
        }
    }, [config, loading])

    const getOAuthStatusColor = (status: OAuthStatus): string => {
        switch (status) {
            case 'authenticated':
                return 'text-green-500'
            case 'needs_auth':
                return 'text-yellow-500'
            case 'error':
                return 'text-red-500'
            case 'not_required':
                return 'text-gray-400'
            default:
                return 'text-gray-400'
        }
    }

    const getOAuthStatusIcon = (status: OAuthStatus): string => {
        switch (status) {
            case 'authenticated':
                return '🔐'
            case 'needs_auth':
                return '⚠️'
            case 'error':
                return '❌'
            case 'not_required':
                return '🔓'
            default:
                return '❓'
        }
    }

    const countEntries = (obj: Record<string, any> | null | undefined) => {
        if (!obj) return 0
        return Object.keys(obj).filter((k) => k !== '_metadata').length
    }
    const getCounts = (name: string) => ({
        tools: countEntries((toolPerms as any)?.[name]),
        resources: countEntries((resourcePerms as any)?.[name]),
        prompts: countEntries((promptPerms as any)?.[name]),
    })

    const renderPermGroup = (
        title: string,
        data: ToolPerms | ResourcePerms | PromptPerms | null,
        setData: React.Dispatch<React.SetStateAction<any>>,
        collapsible: boolean = false,
        innerCollapsible: boolean = true,
    ) => {
        if (!data) return null
        const groups = Object.entries(data).filter(([k]) => k !== '_metadata') as Array<[string, Record<string, PermissionFlags>]>
        const isServerEnabled = (name: string) => Boolean(config?.mcp_servers?.find(s => s.name === name)?.enabled)
        const inner = (
            <div className="space-y-2">
                {groups.length === 0 && <div className="text-xs text-app-muted">No entries</div>}
                {groups.map(([groupName, entries]) => (
                    <div key={groupName} className="border border-app-border rounded p-2">
                        {innerCollapsible ? (
                            <details open={isServerEnabled(groupName)}>
                                <summary className="text-xs text-app-muted cursor-pointer select-none">
                                    {groupName}
                                </summary>
                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {Object.entries(entries).map(([itemName, flags]) => (
                                        <div key={itemName} className="border border-app-border rounded p-2 bg-app-bg/50">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="font-medium text-sm truncate" title={`${groupName}.${itemName}`}>{itemName}</div>
                                                <div className="text-xs flex items-center gap-2">
                                                    <Toggle checked={!!flags.enabled} onChange={(v) => {
                                                        setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], enabled: v } } }))
                                                    }} />
                                                    <span>{flags.enabled ? 'Enabled' : 'Disabled'}</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-app-muted mt-1">{flags.description || 'No description provided'}</div>
                                            <div className="mt-2 grid grid-cols-1 gap-2">
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.write_operation} onChange={(e) => {
                                                        setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], write_operation: e.target.checked } } }))
                                                    }} />
                                                    <span>write_operation</span>
                                                </label>
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.read_private_data} onChange={(e) => {
                                                        setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], read_private_data: e.target.checked } } }))
                                                    }} />
                                                    <span>read_private_data</span>
                                                </label>
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.read_untrusted_public_data} onChange={(e) => {
                                                        setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], read_untrusted_public_data: e.target.checked } } }))
                                                    }} />
                                                    <span>read_untrusted_public_data</span>
                                                </label>
                                                <div className="text-xs border border-app-border rounded px-2 py-1 bg-app-bg/50 flex items-center justify-between">
                                                    <label className="text-xs text-app-muted mr-2">Access level</label>
                                                    <select
                                                        className="text-xs bg-app-bg border border-app-border rounded px-2 py-1"
                                                        value={(flags as any).acl ?? 'PUBLIC'}
                                                        onChange={(e) => {
                                                            const val = (e.target.value || 'PUBLIC') as 'PUBLIC' | 'PRIVATE' | 'SECRET'
                                                            setData((prev: any) => ({
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: { ...prev[groupName][itemName], acl: val }
                                                                }
                                                            }))
                                                        }}
                                                    >
                                                        <option value="PUBLIC">PUBLIC</option>
                                                        <option value="PRIVATE">PRIVATE</option>
                                                        <option value="SECRET">SECRET</option>
                                                    </select>
                                                </div>
                                            </div>
                                            {/* Validate & import permissions if this server has no entries yet */}
                                            {(!toolPerms?.[groupName] && !resourcePerms?.[groupName] && !promptPerms?.[groupName]) && (
                                                <div className="mt-2">
                                                    <button className="button" onClick={() => validateAndImport(groupName)}>Validate & import</button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {Object.entries(entries).map(([itemName, flags]) => (
                                    <div key={itemName} className="border border-app-border rounded p-2 bg-app-bg/50">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="font-medium text-sm truncate" title={`${groupName}.${itemName}`}>{itemName}</div>
                                            <div className="text-xs flex items-center gap-2">
                                                <Toggle checked={!!flags.enabled} onChange={(v) => {
                                                    setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], enabled: v } } }))
                                                }} />
                                                <span>{flags.enabled ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-app-muted mt-1">{flags.description || 'No description provided'}</div>
                                        <div className="mt-2 grid grid-cols-1 gap-2">
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.write_operation} onChange={(e) => {
                                                    setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], write_operation: e.target.checked } } }))
                                                }} />
                                                <span>write_operation</span>
                                            </label>
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.read_private_data} onChange={(e) => {
                                                    setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], read_private_data: e.target.checked } } }))
                                                }} />
                                                <span>read_private_data</span>
                                            </label>
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.read_untrusted_public_data} onChange={(e) => {
                                                    setData((prev: any) => ({ ...prev, [groupName]: { ...prev[groupName], [itemName]: { ...prev[groupName][itemName], read_untrusted_public_data: e.target.checked } } }))
                                                }} />
                                                <span>read_untrusted_public_data</span>
                                            </label>
                                            <div className="text-xs border border-app-border rounded px-2 py-1 bg-app-bg/50 flex items-center justify-between">
                                                <label className="text-xs text-app-muted mr-2">Access level</label>
                                                <select
                                                    className="text-xs bg-app-bg border border-app-border rounded px-2 py-1"
                                                    value={(flags as any).acl ?? 'PUBLIC'}
                                                    onChange={(e) => {
                                                        const val = (e.target.value || 'PUBLIC') as 'PUBLIC' | 'PRIVATE' | 'SECRET'
                                                        setData((prev: any) => ({
                                                            ...prev,
                                                            [groupName]: {
                                                                ...prev[groupName],
                                                                [itemName]: { ...prev[groupName][itemName], acl: val }
                                                            }
                                                        }))
                                                    }}
                                                >
                                                    <option value="PUBLIC">PUBLIC</option>
                                                    <option value="PRIVATE">PRIVATE</option>
                                                    <option value="SECRET">SECRET</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        )
        return (
            <div className="card">
                {collapsible ? (
                    <details open>
                        <summary className="text-sm font-semibold cursor-pointer select-none">{title}</summary>
                        <div className="mt-2">{inner}</div>
                    </details>
                ) : (
                    <>
                        <div className="text-sm font-semibold mb-2">{title}</div>
                        {inner}
                    </>
                )}
            </div>
        )
    }

    if (loading) return <div className="card">Loading…</div>
    if (error) return <div className="card danger">{error}</div>
    if (!config) return <div className="card">No config loaded</div>

    return (
        <div className="space-y-4">
            <div className="card">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold">Servers</div>
                        <div className="text-xs text-app-muted">Click a tile to edit. Toggle enable and set API keys as needed.</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex border border-app-border rounded overflow-hidden">
                            <button className={`px-3 py-1 text-xs ${viewMode === 'section' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => setViewMode('section')}>Section</button>
                            <button className={`px-3 py-1 text-xs ${viewMode === 'tiles' ? 'text-app-accent bg-app-accent/10' : ''}`} onClick={() => setViewMode('tiles')}>Tiles</button>
                        </div>
                        <button className="button" disabled={saving} onClick={() => saveAll(true)}>{saving ? 'Saving…' : 'Save'}</button>
                        <button className="button" disabled={saving} onClick={reinitializeServers}>{saving ? 'Saving and reinitializing…' : 'Save and reinitialize'}</button>

                    </div>
                </div>
                {viewMode === 'section' ? (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from(new Set([
                            ...((config.mcp_servers || []).map(s => (s.name || '').trim())),
                            ...defaults.map(d => (d.name || '').trim())
                        ])).map((srvName) => {
                            const def = defaults.find(d => (d.name || '').trim().toLowerCase() === srvName.toLowerCase()) || { name: srvName } as MCPServerDefault
                            const existing = (config.mcp_servers || []).find(
                                s => (s.name || '').trim().toLowerCase() === srvName.toLowerCase()
                            )
                            const enabled = !!existing?.enabled
                            // API key defaults removed; manage via config.json env
                            return (
                                <div key={def.name} className="border border-app-border rounded p-3 bg-app-bg/50">
                                    <details open>
                                        <summary className="flex items-start justify-between gap-2 cursor-pointer select-none">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold">{def.name}</span>
                                                    {(() => {
                                                        // Only show OAuth indicators for remote servers
                                                        const serverConfig = (config.mcp_servers || []).find(
                                                            s => (s.name || '').trim().toLowerCase() === def.name.toLowerCase()
                                                        )
                                                        if (!serverConfig || !isRemoteServer(serverConfig)) {
                                                            return null
                                                        }
                                                        
                                                        const oauthStatus = oauthInfo[def.name]?.status || 'unknown'
                                                        const oauthIcon = getOAuthStatusIcon(oauthStatus)
                                                        const oauthColor = getOAuthStatusColor(oauthStatus)
                                                        if (oauthStatus !== 'unknown' && oauthStatus !== 'not_required') {
                                                            return (
                                                                <span 
                                                                    className={`text-sm ${oauthColor}`}
                                                                    title={`OAuth status: ${oauthStatus}`}
                                                                >
                                                                    {oauthIcon}
                                                                </span>
                                                            )
                                                        }
                                                        return null
                                                    })()}
                                                </div>
                                                {(() => {
                                                    const c = getCounts(def.name); const err = validateErrors[def.name]; return (
                                                        <div className="text-xs mt-0.5">
                                                            <span className="text-app-muted">{c.tools} tools · {c.resources} resources · {c.prompts} prompts</span>
                                                            {validateInProgress === def.name && <span className="ml-2 text-app-muted">(validating…)</span>}
                                                            {err && <div className="text-rose-400 mt-1">{err}</div>}
                                                        </div>
                                                    )
                                                })()}
                                                {(() => {
                                                    // Only show OAuth messages for remote servers
                                                    const serverConfig = (config.mcp_servers || []).find(
                                                        s => (s.name || '').trim().toLowerCase() === def.name.toLowerCase()
                                                    )
                                                    if (!serverConfig || !isRemoteServer(serverConfig)) {
                                                        return null
                                                    }
                                                    
                                                    const oauthStatus = oauthInfo[def.name]?.status
                                                    const oauthErrorMsg = oauthInfo[def.name]?.error_message || oauthError[def.name]
                                                    if (oauthErrorMsg) {
                                                        return <div className="text-xs text-red-400 mt-1">OAuth: {oauthErrorMsg}</div>
                                                    }
                                                    if (oauthStatus === 'needs_auth') {
                                                        return <div className="text-xs text-yellow-500 mt-1">OAuth authentication required</div>
                                                    }
                                                    if (oauthStatus === 'authenticated') {
                                                        const expiresAt = oauthInfo[def.name]?.token_expires_at
                                                        if (expiresAt) {
                                                            return <div className="text-xs text-green-500 mt-1">OAuth authenticated (expires: {new Date(expiresAt).toLocaleDateString()})</div>
                                                        }
                                                        return <div className="text-xs text-green-500 mt-1">OAuth authenticated</div>
                                                    }
                                                    return null
                                                })()}
                                            </div>
                                            <div className="text-xs flex items-center gap-2">
                                                <Toggle checked={enabled} onChange={(v) => toggleServer(def.name, v)} />
                                                <span>{enabled ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                        </summary>
                                        <div className="mt-2">
                                            {/* No API key field by default; configure in config.json env */}
                                            <details className="mt-2">
                                                <summary className="text-xs cursor-pointer">Command</summary>
                                                <div className="text-xs font-mono mt-1">
                                                    {existing ? (
                                                        <>
                                                            <div><span className="text-app-muted">cmd:</span> {(existing.command ?? '').trim() || '(not set)'}</div>
                                                            <div><span className="text-app-muted">args:</span> {(Array.isArray(existing.args) ? existing.args : []).join(' ')}</div>
                                                        </>
                                                    ) : (
                                                        <div className="text-app-muted">Not configured</div>
                                                    )}
                                                </div>
                                            </details>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <button className="button" onClick={() => validateAndImport(def.name)}>Validate & import</button>
                                                <button className="button" onClick={() => quickStart(def.name)}>Quick start</button>
                                                {(() => {
                                                    const c = getCounts(def.name); return (enabled && (c.tools + c.resources + c.prompts) > 0) ? (
                                                        <button className="button" onClick={() => autoConfigure(def.name)}>Autoconfig</button>
                                                    ) : null
                                                })()}
                                                
                                                {/* OAuth buttons */}
                                                {(() => {
                                                    // Only show OAuth buttons for remote servers
                                                    const serverConfig = (config.mcp_servers || []).find(
                                                        s => (s.name || '').trim().toLowerCase() === def.name.toLowerCase()
                                                    )
                                                    if (!serverConfig || !isRemoteServer(serverConfig)) {
                                                        return null
                                                    }
                                                    
                                                    const oauthStatus = oauthInfo[def.name]?.status
                                                    const isOAuthLoading = oauthLoading[def.name]
                                                    
                                                    if (oauthStatus === 'needs_auth') {
                                                        return (
                                                            <button 
                                                                className="button"
                                                                onClick={() => testConnection(def.name)}
                                                                disabled={isOAuthLoading}
                                                                title="Test connection and authorize OAuth if needed"
                                                            >
                                                                {isOAuthLoading ? 'Testing...' : '🔗 Test Connection'}
                                                            </button>
                                                        )
                                                    }
                                                    
                                                    if (oauthStatus === 'authenticated') {
                                                        return (
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    className="button"
                                                                    onClick={() => refreshServerOAuth(def.name)}
                                                                    disabled={isOAuthLoading}
                                                                    title="Refresh OAuth status"
                                                                >
                                                                    {isOAuthLoading ? 'Refreshing...' : '🔄 Refresh OAuth'}
                                                                </button>
                                                                <button 
                                                                    className="button"
                                                                    onClick={() => clearServerTokens(def.name)}
                                                                    disabled={isOAuthLoading}
                                                                    title="Clear stored OAuth tokens"
                                                                >
                                                                    {isOAuthLoading ? 'Clearing...' : '🗑️ Clear Tokens'}
                                                                </button>
                                                            </div>
                                                        )
                                                    }
                                                    
                                                    if (oauthStatus === 'error' || oauthStatus === 'expired') {
                                                        return (
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    className="button"
                                                                    onClick={() => refreshServerOAuth(def.name)}
                                                                    disabled={isOAuthLoading}
                                                                    title="Refresh OAuth status"
                                                                >
                                                                    {isOAuthLoading ? 'Refreshing...' : '🔄 Refresh OAuth'}
                                                                </button>
                                                                <button 
                                                                    className="button"
                                                                    onClick={() => testConnection(def.name)}
                                                                    disabled={isOAuthLoading}
                                                                    title="Test connection and re-authorize OAuth"
                                                                >
                                                                    {isOAuthLoading ? 'Testing...' : '🔗 Test Connection'}
                                                                </button>
                                                            </div>
                                                        )
                                                    }
                                                    
                                                    return null
                                                })()}
                                            </div>
                                        </div>
                                    </details>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {defaults.map(def => {
                                const existing = (config.mcp_servers || []).find(s => (s.name || '').trim().toLowerCase() === (def.name || '').trim().toLowerCase())
                                const enabled = !!existing?.enabled
                                const selected = selectedServer === def.name
                                return (
                                    <button key={def.name} className={`text-left border rounded p-3 transition-colors ${selected ? 'border-app-accent bg-app-accent/5' : 'border-app-border bg-app-bg/50 hover:bg-app-border/20'}`} onClick={() => setSelectedServer(def.name)}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="font-semibold">{def.name}</div>
                                                <div className="text-xs text-app-muted mt-0.5">Derived from permissions files</div>
                                            </div>
                                            <span className={`text-xs ${enabled ? 'text-blue-400' : 'text-app-muted'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                        {selectedServer && (
                            <div className="mt-4 space-y-3">
                                {renderPermGroup(`Tools — ${selectedServer}`, filterPerms(toolPerms, selectedServer), setToolPerms, false, false)}
                                {renderPermGroup(`Resources — ${selectedServer}`, filterPerms(resourcePerms, selectedServer), setResourcePerms, false, false)}
                                {renderPermGroup(`Prompts — ${selectedServer}`, filterPerms(promptPerms, selectedServer), setPromptPerms, false, false)}
                            </div>
                        )}
                    </>
                )}
                {/* Edison Watch API Key controls at bottom */}
                <div className="mt-3 border border-app-border rounded p-2 bg-app-bg/50">
                    <div className="text-xs text-app-muted mb-1">Edison Watch API key</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type={apiKeyVisible ? 'text' : 'password'}
                            className="button !py-1.5 !px-2 w-[260px]"
                            placeholder="Enter API key"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                        />
                        <button className="button" onClick={() => setApiKeyVisible(v => !v)}>{apiKeyVisible ? 'Hide' : 'Show'}</button>
                        <button className="button" disabled={savingKey} onClick={saveExternalApiKey}>{savingKey ? 'Saving…' : 'Save key'}</button>
                    </div>
                </div>
            </div>

            {viewMode === 'section' && (
                <>
                    {renderPermGroup('Tools', toolPerms, setToolPerms, true, true)}
                    {renderPermGroup('Resources', resourcePerms, setResourcePerms, true, true)}
                    {renderPermGroup('Prompts', promptPerms, setPromptPerms, true, true)}
                </>
            )}

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ${toast.type === 'success'
                    ? 'bg-green-500 text-white'
                    : 'bg-red-500 text-white'
                    }`}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{toast.message}</span>
                        <button
                            onClick={() => setToast(null)}
                            className="ml-3 text-white hover:text-gray-200 text-lg font-bold"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function filterPerms<T extends Record<string, any> | null>(data: T, server: string): T {
    if (!data) return data
    const result: any = { ...(data || {}) }
    for (const key of Object.keys(result)) {
        if (key === '_metadata') continue
        if (key !== server) delete result[key]
    }
    return result
}

