import React, { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import initSqlJs from 'sql.js'
import Editor from '@monaco-editor/react'

type ToolCall = {
    id: string
    tool_name: string
    parameters: Record<string, unknown>
    timestamp: string
    duration_ms?: number | null
    status?: string
    result?: unknown
}

type Session = {
    session_id: string
    correlation_id: string
    tool_calls: ToolCall[]
    data_access_summary: Record<string, unknown>
}

type SessionsResponse = { sessions: Session[] }

function useSessions(dbPath: string) {
    const [data, setData] = useState<SessionsResponse | null>(null)
    const [loading, setLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        const fetchSessions = async () => {
            setLoading(true)
            setError(null)
            try {
                const SQL = await initSqlJs({ locateFile: (f: string) => `https://sql.js.org/dist/${f}` })
                const fileResp = await fetch(`/@fs${dbPath}`)
                if (!fileResp.ok) throw new Error(`Cannot read DB at ${dbPath}`)
                const buf = new Uint8Array(await fileResp.arrayBuffer())
                const db = new SQL.Database(buf as any as BufferSource)
                const query = `SELECT session_id, correlation_id, tool_calls, data_access_summary FROM mcp_sessions ORDER BY id DESC LIMIT 200;`
                const result = db.exec(query)
                const sessions: Session[] = []
                if (result.length > 0) {
                    const cols = result[0].columns
                    const rows = result[0].values
                    for (const row of rows) {
                        const record: any = {}
                        cols.forEach((c: string, i: number) => (record[c] = row[i]))
                        const toolCalls = (() => {
                            try { return Array.isArray(record.tool_calls) ? record.tool_calls : JSON.parse(record.tool_calls ?? '[]') } catch { return [] }
                        })()
                        const summary = (() => {
                            try { return typeof record.data_access_summary === 'object' ? record.data_access_summary : JSON.parse(record.data_access_summary ?? '{}') } catch { return {} }
                        })()
                        sessions.push({
                            session_id: String(record.session_id),
                            correlation_id: String(record.correlation_id ?? ''),
                            tool_calls: toolCalls,
                            data_access_summary: summary,
                        })
                    }
                }
                if (active) setData({ sessions })
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Unknown error')
            } finally {
                if (active) setLoading(false)
            }
        }
        void fetchSessions()
        const id = setInterval(fetchSessions, 5_000)
        return () => {
            active = false
            clearInterval(id)
        }
    }, [dbPath])

    return { data, loading, error }
}

function formatDate(iso: string | undefined): string {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso
    }
}

function shortenMiddle(value: string, head: number = 6, tail: number = 4): string {
    if (!value) return ''
    if (value.length <= head + tail + 1) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function getSecurityFlags(summary: Record<string, unknown> | undefined): {
    privateData: boolean
    untrusted: boolean
    external: boolean
} {
    const s: any = summary || {}
    const t = s.lethal_trifecta || s.trifecta || {}
    return {
        privateData: Boolean(t.has_private_data_access),
        untrusted: Boolean(t.has_untrusted_content_exposure),
        external: Boolean(t.has_external_communication),
    }
}

function riskLevel(flags: { privateData: boolean; untrusted: boolean; external: boolean }): {
    label: 'Low' | 'Medium' | 'High'
    colorClass: string
} {
    const count = Number(flags.privateData) + Number(flags.untrusted) + Number(flags.external)
    if (count >= 2) return { label: 'High', colorClass: 'text-rose-400' }
    if (count === 1) return { label: 'Medium', colorClass: 'text-amber-400' }
    return { label: 'Low', colorClass: 'text-green-400' }
}

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

    const [view, setView] = useState<'sessions' | 'configs'>('sessions')

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
                        <button className={`px-3 py-1 text-sm ${view === 'configs' ? 'text-app-accent bg-app-accent/10' : ''}`} onClick={() => setView('configs')}>Configs</button>
                    </div>
                    <button className="button" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
                        {theme === 'light' ? 'Dark' : 'Light'} mode
                    </button>
                    <button className="button" onClick={() => location.reload()}>Refresh</button>
                </div>
            </div>

            {view === 'sessions' ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="card flex items-center gap-3">
                            <div>
                                <div className="text-xs text-app-muted">Total sessions</div>
                                <div className="text-xl font-bold">{filtered.length}</div>
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
            ) : (
                <JsonEditors projectRoot={projectRoot} />
            )}
        </div>
    )
}

function Timeline({ sessions, startDay, endDay, onRangeChange }: {
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
    const [status, setStatus] = useState<string>('')
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
            setStatus('Saved')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save. You can use Download to save manually.')
            setStatus('')
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
                            {status && <span className="text-xs text-app-muted">{status}</span>}
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



