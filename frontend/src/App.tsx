import React, { useEffect, useMemo, useState } from 'react'
import './index.css'
import Editor from '@monaco-editor/react'
import { useSessions } from './hooks'
import type { Session, OAuthServerInfo, OAuthStatusResponse, OAuthAuthorizeRequest, OAuthStatus, ToolSchemasResponse, ToolSchemaEntry } from './types'
import { SessionTable } from './components/SessionTable'
import { Toggle } from './components/Toggle'
import AgentDataflow from './components/AgentDataflow'
import Stats from './components/Stats'
import Kpis from './components/Kpis'
import DateRangeSlider from './components/DateRangeSlider'

// Embedding/Electron detection
const isEmbedded = (() => {
    try { return window.top !== window.self } catch { return true }
})()
const isLikelyElectron = !!(
    typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('Electron')
)

// Helper function to get API key with proper fallback order
const getApiKey = (): string => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlApiKey = urlParams.get('api_key') || ''
    const globalApiKey = (window as any).OPEN_EDISON_API_KEY || ''

    // Always try localStorage first (it should contain the API key from URL parameter)
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const storedKey = localStorage.getItem('api_key')
            if (storedKey) {
                console.log('✅ Using stored API key from localStorage:', storedKey)
                return storedKey
            }
        }
    } catch { /* ignore */ }

    // Fallback to global variable
    if (globalApiKey) {
        console.log('✅ Using global API key:', globalApiKey)
        return globalApiKey
    }

    // Fallback to URL parameter
    if (urlApiKey) {
        console.log('✅ Using URL API key:', urlApiKey)
        return urlApiKey
    }

    console.log('❌ No API key found in localStorage, global, or URL')
    return ''
}

// Simple localStorage wrapper that handles security restrictions
const safeLocalStorage = {
    getItem: (key: string): string | null => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null
            return localStorage.getItem(key)
        } catch (error) {
            console.warn('localStorage.getItem failed:', error)
            return null
        }
    },
    setItem: (key: string, value: string): boolean => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return false
            localStorage.setItem(key, value)
            return true
        } catch (error) {
            console.warn('localStorage.setItem failed:', error)
            return false
        }
    },
    removeItem: (key: string): boolean => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return false
            localStorage.removeItem(key)
            return true
        } catch (error) {
            console.warn('localStorage.removeItem failed:', error)
            return false
        }
    }
}

// Ensure dev default API key is present for standalone only
if (typeof window !== 'undefined' && !(isEmbedded || isLikelyElectron)) {
    try {
        const existing = localStorage?.getItem('api_key')
        if (!existing) localStorage?.setItem('api_key', 'dev-api-key-change-me')
    } catch { /* ignore */ }
}

// Module-level cache of tool schemas, refreshed on reinitialize
let TOOL_SCHEMAS: Record<string, Record<string, ToolSchemaEntry>> = {}

function _typeTextFromSchema(s: any): string {
    if (!s || typeof s !== 'object') return 'any'
    const t = s.type
    if (Array.isArray(t)) {
        const noNull = t.filter((x) => x !== 'null')
        return noNull.length > 0 ? noNull.join('|') : 'any'
    }
    if (typeof t === 'string') {
        if (t === 'array') {
            const items = s.items || {}
            return `array<${_typeTextFromSchema(items)}>`
        }
        return t
    }
    if (s.oneOf && Array.isArray(s.oneOf)) {
        return `oneOf<${s.oneOf.map((x: any) => _typeTextFromSchema(x)).join('|')}>`
    }
    if (s.anyOf && Array.isArray(s.anyOf)) {
        return `anyOf<${s.anyOf.map((x: any) => _typeTextFromSchema(x)).join('|')}>`
    }
    if (s.enum && Array.isArray(s.enum)) {
        return `enum<${s.enum.map((x: any) => JSON.stringify(x)).join(', ')}>`
    }
    return 'any'
}

function summarizeJsonSchema(schema: unknown): { entries: Array<{ name: string; typeText: string; optional: boolean; description?: string }> } | null {
    const sch: any = schema as any
    if (!sch || typeof sch !== 'object') return null
    // Prefer object with properties
    const props = sch.properties && typeof sch.properties === 'object' ? sch.properties : null
    if (!props) return null
    const required: string[] = Array.isArray(sch.required) ? sch.required : []
    const entries: Array<{ name: string; typeText: string; optional: boolean; description?: string }> = []
    for (const [name, propSchema] of Object.entries<any>(props)) {
        const typeText = _typeTextFromSchema(propSchema)
        const optional = !required.includes(name)
        const description: string | undefined = typeof propSchema?.description === 'string' ? propSchema.description : undefined
        entries.push({ name, typeText, optional, description })
    }
    if (entries.length === 0) return null
    return { entries }
}

async function fetchToolSchemasExternal(projectRoot: string): Promise<Record<string, Record<string, ToolSchemaEntry>>> {
    try {
        const storedKey = getApiKey()
        const headersCfg: Record<string, string> = { 'Cache-Control': 'no-cache' }
        if (storedKey) headersCfg['Authorization'] = `Bearer ${storedKey}`
        const isDev = !!((import.meta as any)?.env?.DEV)
        let configResponse: Response
        if (isDev && projectRoot) {
            configResponse = await fetch(`/@fs${projectRoot}/config.json`, { cache: 'no-cache', headers: headersCfg })
            if (!configResponse.ok) configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfg })
            if (!configResponse.ok) return {}
        } else {
            configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfg })
            if (!configResponse.ok) return {}
        }
        const configData = await configResponse.json()
        const apiKey = configData?.server?.api_key || ''
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        const resp = await fetch('/mcp/tool-schemas', { method: 'GET', headers })
        if (!resp.ok) return {}
        const data = await resp.json() as ToolSchemasResponse
        return data.tool_schemas || {}
    } catch {
        return {}
    }
}

export function App(): React.JSX.Element {
    // Always read from sessions.db (canonical name)
    const dbRelativeToProjectRoot = '/sessions.db'

    // Get API key from URL query parameter (set by Electron app) and store in localStorage
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const apiKey = urlParams.get('api_key');
        console.log('🔑 URL search params:', window.location.search);
        console.log('🔑 API key from URL:', apiKey);
        if (apiKey) {
            try {
                safeLocalStorage.setItem('api_key', apiKey);
                console.log('✅ API key stored in localStorage from URL parameter:', apiKey);
                // Also set it globally for immediate use
                (window as any).OPEN_EDISON_API_KEY = apiKey;
                console.log('✅ API key also set globally for immediate use');
            } catch (error) {
                console.error('❌ Failed to set API key in localStorage:', error);
            }
        } else {
            console.log('⚠️ No API key found in URL parameters');
        }
    }, []);
    // Vite injects __PROJECT_ROOT__ from vite.config.ts define
    const dbAbsolutePath = (globalThis as any).__PROJECT_ROOT__
        ? `${(globalThis as any).__PROJECT_ROOT__}${dbRelativeToProjectRoot}`
        : `${window.location.pathname}${dbRelativeToProjectRoot}`
    const [reloadCounter, setReloadCounter] = useState(0)
    const { data, loading, error } = useSessions(`${dbAbsolutePath}?r=${reloadCounter}`)

    type UISession = Session & { ts: number; day: string }
    const sessions = useMemo(() => (data?.sessions ?? []) as Session[], [data])
    const uiSessions: UISession[] = useMemo(() => {
        return (data?.sessions ?? []).map((s) => {
            const iso = s.created_at || s.tool_calls[0]?.timestamp
            const ts = iso ? Date.parse(iso) : 0
            const day = iso && !Number.isNaN(ts) ? new Date(ts).toISOString().slice(0, 10) : ''
            return { ...s, ts, day }
        })
    }, [data])

    // Day range filter (calendar selectors)
    const [startDay, setStartDay] = useState<string>('')
    const [endDay, setEndDay] = useState<string>('')
    const [showUnknown, setShowUnknown] = useState<boolean>(false)
    const [hoverTimeLabel, setHoverTimeLabel] = useState<string | null>(null)
    const [rangeMs, setRangeMs] = useState<{ start: number; end: number } | null>(null)
    const [nowMs, setNowMs] = useState<number>(() => Date.now())

    const compareDays = (a?: string, b?: string) => {
        if (!a && !b) return 0
        if (!a) return -1
        if (!b) return 1
        return a.localeCompare(b)
    }

    const filtered = useMemo(() => {
        return uiSessions.filter((s) => {
            if (!s.day) return false
            if (startDay && compareDays(s.day, startDay) < 0) return false
            if (endDay && compareDays(s.day, endDay) > 0) return false
            return true
        })
    }, [uiSessions, startDay, endDay])

    const unknownSessions = useMemo(() => uiSessions.filter((s) => !s.day), [uiSessions])

    // Further filter by precise ms time range for Observability (sub-day windows)
    const timeFiltered = useMemo(() => {
        const a = rangeMs?.start
        const b = rangeMs?.end
        if (typeof a !== 'number' || typeof b !== 'number') return filtered
        return filtered
            .map((s) => {
                const calls = s.tool_calls.filter((tc) => {
                    const t = Date.parse(String((tc as any)?.timestamp))
                    return !Number.isNaN(t) && t >= a && t <= b
                })
                return { ...s, tool_calls: calls }
            })
            .filter((s) => s.tool_calls.length > 0)
    }, [filtered, rangeMs])

    // Compute previous period window (same length immediately before current)
    const prevTimeFiltered = useMemo(() => {
        let currStart: number | null = null
        let currEnd: number | null = null
        if (typeof rangeMs?.start === 'number' && typeof rangeMs?.end === 'number') {
            currStart = rangeMs.start
            currEnd = rangeMs.end
        } else if (startDay && endDay) {
            // Interpret as local dates
            const s = new Date(`${startDay}T00:00:00`).getTime()
            // end inclusive to end-of-day
            const e = new Date(`${endDay}T23:59:59.999`).getTime()
            if (!Number.isNaN(s) && !Number.isNaN(e)) { currStart = s; currEnd = e }
        }
        if (currStart == null || currEnd == null) return []
        const dur = Math.max(0, currEnd - currStart)
        if (dur <= 0) return []
        const prevStart = currStart - dur
        const prevEnd = currStart
        // Filter across all sessions (not day-limited) for the previous window
        return uiSessions
            .map((s) => {
                const calls = s.tool_calls.filter((tc) => {
                    const t = Date.parse(String((tc as any)?.timestamp))
                    return !Number.isNaN(t) && t >= prevStart && t <= prevEnd
                })
                return { ...s, tool_calls: calls }
            })
            .filter((s) => s.tool_calls.length > 0)
    }, [uiSessions, rangeMs, startDay, endDay])

    const totalCalls = useMemo(() => {
        const base = filtered.reduce((acc, s) => acc + s.tool_calls.length, 0)
        if (!showUnknown) return base
        return base + unknownSessions.reduce((acc, s) => acc + s.tool_calls.length, 0)
    }, [filtered, unknownSessions, showUnknown])
    const [theme, setTheme] = useState<'light' | 'dark' | 'blue'>(() => {
        try {
            const saved = safeLocalStorage.getItem('app-theme')
            if (saved === 'light' || saved === 'dark' || saved === 'blue') {
                return saved
            }
        } catch { /* ignore */ }
        // Fallback to system preference
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    })

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    // Save theme state to localStorage whenever it changes
    useEffect(() => {
        try {
            safeLocalStorage.setItem('app-theme', theme)
        } catch { /* ignore */ }
    }, [theme])

    // Listen for theme changes from Electron
    useEffect(() => {
        // Create global theme setter for Electron to call
        (window as any).__setTheme = (newTheme: 'light' | 'dark' | 'blue') => {
            if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'blue') {
                setTheme(newTheme)
            }
        }

        // Also listen to theme-changed event
        const handleThemeChange = (event: CustomEvent) => {
            const newTheme = event.detail?.effective
            if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'blue') {
                setTheme(newTheme)
            }
        }

        window.addEventListener('theme-changed', handleThemeChange as EventListener)

        return () => {
            window.removeEventListener('theme-changed', handleThemeChange as EventListener)
            delete (window as any).__setTheme
        }
    }, [])

    const projectRoot = (globalThis as any).__PROJECT_ROOT__ || ''

    const [view, setView] = useState<'sessions' | 'configs' | 'manager' | 'observability' | 'agents'>(() => {
        try {
            const saved = safeLocalStorage.getItem('app_view')
            if (saved === 'sessions' || saved === 'configs' || saved === 'manager' || saved === 'observability' || saved === 'agents') {
                return saved
            }
        } catch { /* ignore */ }
        return 'sessions'
    })
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

    // Handle view changes with unsaved changes warning
    const handleViewChange = (newView: 'sessions' | 'configs' | 'manager' | 'observability' | 'agents') => {
        if (hasUnsavedChanges && view === 'configs') {
            const confirmed = window.confirm('You have unsaved changes in the JSON editor. Are you sure you want to switch views? Your changes will be lost.')
            if (!confirmed) return
        }
        setView(newView)
    }

    // Save view state to localStorage whenever it changes
    useEffect(() => {
        try {
            safeLocalStorage.setItem('app_view', view)
        } catch { /* ignore */ }
    }, [view])

    // MCP Server Status
    const [mcpStatus, setMcpStatus] = useState<'checking' | 'online' | 'reduced' | 'offline'>('checking')

    // App-level toast (e.g., approval confirmations)
    const [uiToast, setUiToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    useEffect(() => {
        if (!uiToast) return
        const t = setTimeout(() => setUiToast(null), 5000)
        return () => clearTimeout(t)
    }, [uiToast])

    // In-page approval queue (fallback when OS notifications aren't visible)
    type PendingApproval = { id: string; sessionId: string; kind: 'tool' | 'resource' | 'prompt'; name: string; reason?: string }
    const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
    const [lastBannerAt, setLastBannerAt] = useState<number>(0)
    const [emphasize, setEmphasize] = useState(false)
    useEffect(() => {
        if (!lastBannerAt) return
        setEmphasize(true)
        const t = setTimeout(() => setEmphasize(false), 2500)
        return () => clearTimeout(t)
    }, [lastBannerAt])
    const approveItem = async (item: PendingApproval) => {
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = getApiKey()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
            await fetch(`/api/approve_or_deny`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ session_id: item.sessionId, kind: item.kind, name: item.name, command: "approve" })
            })
            setUiToast({ message: `Approved ${item.kind} '${item.name}'`, type: 'success' })
        } catch {
            setUiToast({ message: `Failed to approve ${item.kind} '${item.name}'`, type: 'error' })
        } finally {
            setPendingApprovals(prev => prev.filter(p => p.id !== item.id))
        }
    }

    const denyItem = async (item: PendingApproval) => {
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = getApiKey()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
            await fetch(`/api/approve_or_deny`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ session_id: item.sessionId, kind: item.kind, name: item.name, command: "deny" })
            })
            setUiToast({ message: `Denied ${item.kind} '${item.name}'`, type: 'success' })
        } catch {
            setUiToast({ message: `Failed to deny ${item.kind} '${item.name}'`, type: 'error' })
        } finally {
            setPendingApprovals(prev => prev.filter(p => p.id !== item.id))
        }
    }

    // Tool schemas cache lives at module level; no component state needed here

    useEffect(() => {
        const checkMcpStatus = async () => {
            try {
                console.log('🔄 Starting MCP status check...')

                // Load config to get server settings
                const storedKey = getApiKey()
                const headersCfg: Record<string, string> = { 'Cache-Control': 'no-cache' }
                if (storedKey) {
                    headersCfg['Authorization'] = `Bearer ${storedKey}`
                    console.log('Using API key for config request:', storedKey)
                } else {
                    console.log('No API key found in localStorage, global, or URL')
                }
                const isDev = !!((import.meta as any)?.env?.DEV)
                let configResponse: Response
                if (isDev && projectRoot) {
                    configResponse = await fetch(`/@fs${projectRoot}/config.json`, { cache: 'no-cache', headers: headersCfg })
                    if (!configResponse.ok) configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfg })
                } else {
                    configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfg })
                }
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
        // Preload tool schemas on app load (best-effort)
        fetchToolSchemasExternal(projectRoot).then((schemas) => { TOOL_SCHEMAS = schemas; setReloadCounter((prev: number) => prev + 1) })
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

        // Reply to service worker's request for API key
        const onKeyRequest = (ev: MessageEvent) => {
            try {
                const msg = (ev && ev.data) || {}
                if (msg && msg.type === 'OE_GET_API_KEY') {
                    const apiKey = getApiKey()
                    try { (ev.ports && ev.ports[0])?.postMessage({ type: 'OE_API_KEY', apiKey }) } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
        window.addEventListener('message', onKeyRequest)

        // Listen for SW messages that ask us to enqueue a pending approval
        const onMessage = (ev: MessageEvent) => {
            try {
                const msg = ev.data || {}
                if (msg && msg.type === 'MCP_ENQUEUE_PENDING' && msg.data) {
                    const d = msg.data || {}
                    const s = String(d.sessionId || '')
                    const k = d.kind
                    const n = d.name
                    if (s && k && n) {
                        const newItem: PendingApproval = {
                            id: `${Date.now()}-${k}-${n}-${Math.random()}`,
                            sessionId: s,
                            kind: k,
                            name: n,
                            reason: d.reason,
                        }
                        setPendingApprovals(prev => {
                            if (prev.some(p => p.sessionId === newItem.sessionId && p.kind === newItem.kind && p.name === newItem.name)) return prev
                            return [...prev, newItem]
                        })
                        setLastBannerAt(Date.now())
                    }
                }
            } catch { /* ignore */ }
        }
        navigator.serviceWorker?.addEventListener?.('message', onMessage)

        const es = new EventSource(`/events`)
        es.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data || '{}') as any
                if (data?.type === 'sessions_db_changed') {
                    // Bump reload counter to trigger re-fetch in hooks/useSessions via keying
                    setReloadCounter((n) => n + 1)
                    setNowMs(Date.now())
                    return
                }
                if (data?.type === 'mcp_pre_block') {
                    const title = 'Edison blocked a risky action'
                    const body = `${data.kind}: ${data.name}${data.reason ? ` — ${data.reason}` : ''}`
                    const sessionId = data.session_id || ''
                    // Always surface an in-page approval banner as a reliable fallback
                    if (sessionId && data.kind && data.name) {
                        const newItem: PendingApproval = {
                            id: `${Date.now()}-${data.kind}-${data.name}-${Math.random()}`,
                            sessionId,
                            kind: data.kind,
                            name: data.name,
                            reason: data.reason,
                        }
                        setPendingApprovals(prev => {
                            // de-duplicate same pending tuple
                            if (prev.some(p => p.sessionId === newItem.sessionId && p.kind === newItem.kind && p.name === newItem.name)) return prev
                            return [...prev, newItem]
                        })
                        setLastBannerAt(Date.now())
                    }
                    // Try Electron system notification first (if available)
                    const tryElectron = async () => {
                        try {
                            const isElectron = !!(window as any).__ELECTRON_EMBED__ || new URLSearchParams(location.search).get('embed') === 'electron'
                            console.log('🔍 Checking Electron environment:', { 
                                isElectron, 
                                hasElectronAPI: !!(window as any).electronAPI,
                                __ELECTRON_EMBED__: !!(window as any).__ELECTRON_EMBED__,
                                embedParam: new URLSearchParams(location.search).get('embed'),
                                electronAPI: typeof (window as any).electronAPI,
                                showSystemNotification: typeof (window as any).electronAPI?.showSystemNotification
                            })
                            if (isElectron && typeof (window as any).electronAPI !== 'undefined' && typeof (window as any).electronAPI.showSystemNotification === 'function') {
                                console.log('📱 Calling Electron system notification...')
                                console.log('📱 Notification payload:', {
                                    sessionId,
                                    kind: data.kind,
                                    name: data.name,
                                    reason: data.reason,
                                    title,
                                    body
                                })
                                try {
                                    const result = await (window as any).electronAPI.showSystemNotification({
                                        sessionId,
                                        kind: data.kind,
                                        name: data.name,
                                        reason: data.reason,
                                        title,
                                        body
                                    })
                                    console.log('✅ Electron notification result:', result)
                                    return true
                                } catch (error) {
                                    console.error('❌ Electron notification failed:', error)
                                    return false
                                }
                            } else {
                                console.log('❌ Electron notification not available:', { 
                                    isElectron, 
                                    hasElectronAPI: !!(window as any).electronAPI,
                                    hasShowSystemNotification: typeof (window as any).electronAPI?.showSystemNotification === 'function'
                                })
                            }
                        } catch (e) {
                            console.warn('❌ Failed to show Electron system notification:', e)
                        }
                        return false
                    }

                    // Fallback to service worker notification
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
                            }
                        } catch { /* ignore */ }
                    }

                    // Try Electron first, then fallback to service worker
                    const showNotification = async () => {
                        const electronSuccess = await tryElectron()
                        if (!electronSuccess) {
                            void trySW()
                        }
                    }
                    void showNotification()
                }
                // For any other events, still tick now to advance live ranges
                setNowMs(Date.now())
            } catch { /* ignore */ }
        }
        es.onerror = () => {
            try { es.close() } catch { /* ignore */ }
        }

        return () => {
            try { es.close() } catch { /* ignore */ }
            navigator.serviceWorker?.removeEventListener?.('message', onMessage)
            window.removeEventListener('message', onKeyRequest)
        }
    }, [])

    // Listen for notification action completed events from Electron (when approve/deny is clicked on system notification)
    useEffect(() => {
        const isElectron = !!(window as any).__ELECTRON_EMBED__ || new URLSearchParams(location.search).get('embed') === 'electron'
        if (!isElectron) return

        try {
            if (typeof (window as any).electronAPI !== 'undefined' && typeof (window as any).electronAPI.onNotificationActionCompleted === 'function') {
                (window as any).electronAPI.onNotificationActionCompleted((data: { sessionId: string; kind: string; name: string; action: string }) => {
                    // Remove the corresponding item from pendingApprovals
                    setPendingApprovals(prev => prev.filter(p =>
                        !(p.sessionId === data.sessionId && p.kind === data.kind && p.name === data.name)
                    ))
                    console.log(`🔔 Cleared notification from queue: ${data.action} ${data.kind} ${data.name}`)
                })
            }
        } catch (e) {
            console.warn('Failed to setup notification-action-completed listener:', e)
        }
    }, [])

    return (
        <div className="mx-auto max-w-[1400px] p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="m-0 text-2xl font-bold">Open Edison Dashboard</h1>
                    <p className="m-0 text-sm text-app-muted">
                        {view === 'sessions' && 'Live view of recent MCP sessions from the local SQLite store.'}
                        {view === 'configs' && 'Direct JSON editing for configuration and permission files.'}
                        {view === 'manager' && 'Manage MCP servers, tools, and permissions with a guided interface.'}
                        {view === 'agents' && 'Monitor agent identities, sessions, and permission overrides.'}
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    <div className="hidden sm:flex border border-app-border rounded overflow-hidden">
                        <button className={`px-3 py-1 text-sm ${view === 'sessions' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => handleViewChange('sessions')}>Sessions</button>
                        <button className={`px-3 py-1 text-sm ${view === 'agents' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => handleViewChange('agents')}>Agents</button>
                        <button className={`px-3 py-1 text-sm ${view === 'configs' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => handleViewChange('configs')}>Raw Config</button>
                        <button className={`px-3 py-1 text-sm ${view === 'manager' ? 'text-app-accent border-r border-app-border bg-app-accent/10' : ''}`} onClick={() => handleViewChange('manager')}>Server Manager</button>
                        <button className={`px-3 py-1 text-sm ${view === 'observability' ? 'text-app-accent bg-app-accent/10' : ''}`} onClick={() => handleViewChange('observability')}>Observability</button>
                    </div>
                    {/* Hide theme switch when embedded in Electron (exposed via window.__ELECTRON_EMBED__) */}
                    {!(window as any).__ELECTRON_EMBED__ && (new URLSearchParams(location.search).get('embed') !== 'electron') && (
                        <button className="button" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
                            {theme === 'light' ? 'Dark' : 'Light'} mode
                        </button>
                    )}
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

                    {/* Date range selector (shared with Observability) */}
                    <DateRangeSlider
                        sessions={uiSessions}
                        startTimeLabel={startDay}
                        endTimeLabel={endDay}
                        onTimeRangeChange={(s: string, e: string) => { setStartDay(s); setEndDay(e) }}
                        nowMs={nowMs}
                    />
                    {/* Toggle moved into table header */}

                    {/* Timeline removed */}

                    {loading && <div>Loading…</div>}
                    {error && (
                        <div className="danger" style={{ margin: '8px 0' }}>
                            Failed to load sessions: {error}
                        </div>
                    )}

                    {!loading && !error && sessions.length === 0 && (
                        <div className="muted" style={{ marginTop: 12 }}>No sessions recorded yet.</div>
                    )}

                    <SessionTable
                        sessions={filtered}
                        headerRight={(
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-app-muted">Show unknown date</span>
                                <Toggle checked={showUnknown} onChange={setShowUnknown} />
                                {unknownSessions.length > 0 && !showUnknown && (
                                    <span className="text-xs text-app-muted">({unknownSessions.length} hidden)</span>
                                )}
                            </div>
                        )}
                    />

                    {showUnknown && unknownSessions.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs text-app-muted">Unknown date</div>
                            <SessionTable sessions={unknownSessions} />
                        </div>
                    )}
                </div>
            ) : view === 'configs' ? (
                <JsonEditors projectRoot={projectRoot} onUnsavedChangesChange={setHasUnsavedChanges} theme={theme} />
            ) : view === 'manager' ? (
                <ConfigurationManager projectRoot={projectRoot} />
            ) : view === 'agents' ? (
                <AgentsView sessions={uiSessions} />
            ) : (
                <div className="space-y-4">
                    <Kpis sessions={timeFiltered} prevSessions={prevTimeFiltered} />
                    {/* Date range selector for Observability (mirrors Sessions) */}
                    <DateRangeSlider
                        sessions={uiSessions}
                        startTimeLabel={startDay}
                        endTimeLabel={endDay}
                        onTimeRangeChange={(s: string, e: string) => { setStartDay(s); setEndDay(e) }}
                        hoverTimeLabel={hoverTimeLabel}
                        onHoverTimeChange={setHoverTimeLabel}
                        onTimeRangeMsChange={(s, e) => setRangeMs({ start: s, end: e })}
                        nowMs={nowMs}
                    />
                    <AgentDataflow sessions={uiSessions as any} startDay={startDay} endDay={endDay} msStart={rangeMs?.start} msEnd={rangeMs?.end} />
                    <Stats
                        sessions={timeFiltered}
                        onTimeRangeChange={(s, e) => { setStartDay(s); setEndDay(e) }}
                        onHoverTimeChange={setHoverTimeLabel}
                        rangeStartMs={rangeMs?.start}
                        rangeEndMs={rangeMs?.end}
                    />
                </div>
            )}
            {/* In-page approval banner (fallback for OS notifications) */}
            {pendingApprovals.length > 0 && pendingApprovals[0] && (
                <div className={`fixed bottom-4 right-4 z-50 w-[min(92vw,28rem)] transition-transform duration-300 ${emphasize ? 'animate-[pop_300ms_ease-out] translate-y-[-4px]' : ''}`}>
                    {(() => {
                        const item = pendingApprovals[0]!
                        return (
                            <div className="relative p-4 rounded-lg shadow-xl border border-blue-400/60 bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
                                {/* subtle glow */}
                                <div className="absolute -inset-0.5 rounded-lg bg-blue-400/20 blur-md pointer-events-none" aria-hidden="true"></div>
                                <div className="relative text-sm font-semibold mb-1">Approval required</div>
                                <div className="relative text-xs mb-3">
                                    {item.kind}: <span className="font-mono">{item.name}</span>{item.reason ? ` — ${item.reason}` : ''}
                                </div>
                                <div className="relative flex gap-2">
                                    <button className="button !bg-blue-600 !text-white hover:!bg-blue-700" onClick={() => approveItem(item)}>Approve</button>
                                    <button className="button !bg-blue-100 dark:!bg-blue-800/40" onClick={() => denyItem(item)}>Deny</button>
                                </div>
                            </div>
                        )
                    })()}
                </div>
            )}

            {/* Global toast for cross-page confirmations */}
            {uiToast && (
                <div className={`fixed bottom-4 left-4 right-auto z-50 p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ${uiToast.type === 'success'
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

function JsonEditors({ projectRoot, onUnsavedChangesChange, theme }: { projectRoot: string; onUnsavedChangesChange?: (hasUnsaved: boolean) => void; theme: 'light' | 'dark' | 'blue' }) {
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
    const [originalContent, setOriginalContent] = useState<Record<FileKey, string>>({} as any)
    const [edited, setEdited] = useState<Record<FileKey, boolean>>({} as any)
    const [error, setError] = useState<string>('')
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [loadingKey, setLoadingKey] = useState<FileKey | null>(null)

    // Load update flags from localStorage
    const getUpdateFlags = () => {
        try {
            const permissionFlags = safeLocalStorage.getItem('json_editor_needs_permission_update')
            const configFlags = safeLocalStorage.getItem('json_editor_needs_config_update')
            return {
                needsPermissionUpdate: permissionFlags ? JSON.parse(permissionFlags) : {},
                needsConfigUpdate: configFlags ? JSON.parse(configFlags) : {}
            }
        } catch {
            return { needsPermissionUpdate: {}, needsConfigUpdate: {} }
        }
    }


    // Save update flags to localStorage
    const setUpdateFlags = (permissionFlags: Record<FileKey, boolean>, configFlags: Record<FileKey, boolean>) => {
        try {
            safeLocalStorage.setItem('json_editor_needs_permission_update', JSON.stringify(permissionFlags))
            safeLocalStorage.setItem('json_editor_needs_config_update', JSON.stringify(configFlags))
        } catch { /* ignore */ }
    }

    // Initialize update flags from localStorage
    const [updateFlags, setUpdateFlagsState] = useState(getUpdateFlags)

    // Refresh update flags from localStorage when active file changes
    useEffect(() => {
        const loadUpdateFlags = async () => {
            // Validate config update flag first
            try {
                const configFlags = safeLocalStorage.getItem('json_editor_needs_config_update')
                if (configFlags && content.config) {
                    const flags = JSON.parse(configFlags)

                    if (flags.config) {
                        let configResponse: Response
                        const storedKeyUpd = getApiKey()
                        const headersCfgUpd: Record<string, string> = { 'Cache-Control': 'no-cache' }
                        if (storedKeyUpd) headersCfgUpd['Authorization'] = `Bearer ${storedKeyUpd}`
                        if (projectRoot) {
                            configResponse = await fetch(`/@fs${projectRoot}/config.json`, { cache: 'no-cache', headers: headersCfgUpd })
                            if (!configResponse.ok) {
                                configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfgUpd })
                                if (!configResponse.ok) return {}
                            }
                        } else {
                            configResponse = await fetch(`/config.json`, { cache: 'no-cache', headers: headersCfgUpd })
                            if (!configResponse.ok) return {}
                        }
                        const savedConfig = await configResponse.json()
                        const currentConfig = JSON.parse(content.config)
                        const configsMatch = JSON.stringify(savedConfig) === JSON.stringify(currentConfig)

                        if (configsMatch) {
                            // Configurations match, clear the flag
                            console.log('🔄 Configurations match, clearing config update flag')
                            const resetFlags = { ...flags, config: false }
                            safeLocalStorage.setItem('json_editor_needs_config_update', JSON.stringify(resetFlags))
                        }
                    }
                }
            } catch (e) {
                console.warn('⚠️ Failed to validate config update flag:', e)
            }

            // Refresh the state
            setUpdateFlagsState(getUpdateFlags())
        }
        loadUpdateFlags()
    }, [active, content.config, projectRoot])

    // Auto-dismiss toast after 10 seconds
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => {
                setToast(null)
            }, 10000) // 10 seconds

            return () => clearTimeout(timer)
        }
    }, [toast])

    // Check if content has changed and update edited flag
    useEffect(() => {
        if (content[active] !== undefined && originalContent[active] !== undefined) {
            const hasChanged = content[active] !== originalContent[active]
            setEdited(prev => ({ ...prev, [active]: hasChanged }))

            // Mark files as needing updates when they change
            if (hasChanged) {
                const currentFlags = getUpdateFlags()
                if (active === 'tool' || active === 'resource' || active === 'prompt') {
                    const newPermissionFlags = { ...currentFlags.needsPermissionUpdate, [active]: true }
                    setUpdateFlags(newPermissionFlags, currentFlags.needsConfigUpdate)
                    setUpdateFlagsState({ needsPermissionUpdate: newPermissionFlags, needsConfigUpdate: currentFlags.needsConfigUpdate })
                } else if (active === 'config') {
                    const newConfigFlags = { ...currentFlags.needsConfigUpdate, [active]: true }
                    setUpdateFlags(currentFlags.needsPermissionUpdate, newConfigFlags)
                    setUpdateFlagsState({ needsPermissionUpdate: currentFlags.needsPermissionUpdate, needsConfigUpdate: newConfigFlags })
                }
            }
        }
    }, [content, originalContent, active])

    // Check if any files have unsaved changes
    const hasUnsavedChanges = () => {
        return Object.values(edited).some(isEdited => isEdited)
    }

    // Notify parent component of unsaved changes status
    useEffect(() => {
        onUnsavedChangesChange?.(hasUnsavedChanges())
    }, [edited, onUnsavedChangesChange])

    // Warn user before leaving page if there are unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges()) {
                e.preventDefault()
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
                return 'You have unsaved changes. Are you sure you want to leave?'
            }
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [edited])

    useEffect(() => {
        const f = files.find(f => f.key === active)
        if (!f) return
        if (content[active] !== undefined) return
        const load = async () => {
            try {
                setLoadingKey(active)
                // Get API key with fallback helper
                const storedKeyFile = getApiKey()
                const headersFile: Record<string, string> = {}
                if (storedKeyFile) {
                    headersFile['Authorization'] = `Bearer ${storedKeyFile}`
                    console.log('Using API key for file request:', storedKeyFile)
                } else {
                    console.log('No API key found for file request')
                }
                const resp = await fetch(`/@fs${f.path}`, { headers: headersFile })
                if (!resp.ok) throw new Error(`Cannot read ${f.name}`)
                const txt = await resp.text()
                setContent(prev => ({ ...prev, [active]: txt }))
                setOriginalContent(prev => ({ ...prev, [active]: txt }))
                setEdited(prev => ({ ...prev, [active]: false }))
                // Don't reset update flags when loading files - they should persist across tab switches
                // setNeedsPermissionUpdate(prev => ({ ...prev, [active]: false }))
                // setNeedsConfigUpdate(prev => ({ ...prev, [active]: false }))

                // If this is config.json, extract API key and store in localStorage
                if (f.key === 'config') {
                    try {
                        const configData = JSON.parse(txt)
                        if (configData?.server?.api_key) {
                            safeLocalStorage.setItem('api_key', configData.server.api_key)
                        }
                    } catch { /* ignore JSON parse errors */ }
                }
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
            setToast({ message: 'Saved', type: 'success' })
            // Reset edited flag and update original content after successful save
            // Note: Update flags (needsPermissionUpdate, needsConfigUpdate) are NOT reset here
            // They only reset when the actual update buttons are clicked
            setEdited(prev => ({ ...prev, [active]: false }))
            setOriginalContent(prev => ({ ...prev, [active]: content[active] ?? '' }))
        } catch (e) {
            setToast({ message: 'Failed to save', type: 'error' })
        }
    }

    async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal })
            return resp
        } finally {
            clearTimeout(id)
        }
    }

    const updatePermissions = async () => {
        try {
            // Check if there are unsaved changes and save them first
            const hasUnsaved = content[active] !== originalContent[active]
            if (hasUnsaved) {
                setToast({ message: 'Saving changes before updating permissions…', type: 'success' })
                await saveToDisk()
            }

            setToast({ message: 'Updating permissions…', type: 'success' })
            const file = files.find(f => f.key === active)!
            // Clear permission caches after successful save (only for permission files)
            // if (file.key === 'tool' || file.key === 'resource' || file.key === 'prompt') {
            console.log(`🔄 Clearing permission caches after ${file.name} save...`)
            // Load config to get server settings
            const storedKeyCfg = getApiKey()
            const headersCfgRoot: Record<string, string> = { 'Cache-Control': 'no-cache' }
            if (storedKeyCfg) headersCfgRoot['Authorization'] = `Bearer ${storedKeyCfg}`
            const configResponse: Response = await fetch('/config.json', {
                cache: 'no-cache',
                headers: headersCfgRoot
            })
            if (configResponse.ok) {
                const configData = await configResponse.json()
                const serverHost = configData?.server?.host || 'localhost'
                const serverPort = (configData?.server?.port || 3000) + 1 // API runs on port + 1
                const headersPerm: Record<string, string> = { 'Content-Type': 'application/json' }
                const derivedApiKey = (configData?.server?.api_key || '') as string
                if (derivedApiKey) headersPerm['Authorization'] = `Bearer ${derivedApiKey}`
                const cacheResponse = await fetch(`http://${serverHost}:${serverPort}/api/permissions-changed`, {
                    method: 'POST',
                    headers: headersPerm
                })
                if (cacheResponse.ok) {
                    const cacheResult = await cacheResponse.json()
                    console.log('✅ Cache invalidation successful:', cacheResult)
                } else {
                    console.warn('⚠️ Cache invalidation failed (server may not be running):', cacheResponse.status)
                }
            }
            setToast({ message: 'Permissions updated', type: 'success' })
            // Reset permission update flag after successful update
            const currentFlags = getUpdateFlags()
            const newPermissionFlags = { ...currentFlags.needsPermissionUpdate, [active]: false }
            setUpdateFlags(newPermissionFlags, currentFlags.needsConfigUpdate)
            setUpdateFlagsState({ needsPermissionUpdate: newPermissionFlags, needsConfigUpdate: currentFlags.needsConfigUpdate })
        } catch (e) {
            setToast({ message: 'Failed to update permissions', type: 'error' })
        }
    }


    const updateConfig = async () => {
        try {
            // Check if there are unsaved changes and save them first
            const hasUnsaved = content[active] !== originalContent[active]
            if (hasUnsaved) {
                setToast({ message: 'Saving changes before updating configuration…', type: 'success' })
                await saveToDisk()
            }

            setToast({ message: 'Updating open-edison configuration', type: 'success' })
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = getApiKey()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`

            const reinitResponse = await fetchWithTimeout(`/mcp/reinitialize`, { method: 'POST', headers }, 10_000)
            if (!reinitResponse.ok) {
                const errorData = await reinitResponse.json().catch(() => ({} as any))
                throw new Error(errorData.message || `Reinitialize failed (${reinitResponse.status})`)
            }
            setToast({ message: 'Configuration updated', type: 'success' })
            // Reset config update flag after successful update
            const currentFlags = getUpdateFlags()
            const newConfigFlags = { ...currentFlags.needsConfigUpdate, [active]: false }
            setUpdateFlags(currentFlags.needsPermissionUpdate, newConfigFlags)
            setUpdateFlagsState({ needsPermissionUpdate: currentFlags.needsPermissionUpdate, needsConfigUpdate: newConfigFlags })
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError'
            setToast({ message: isAbort ? 'Reinitialize timed out after 10s' : (e?.message || 'Failed to reinitialize'), type: 'error' })
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
                                        <div className="flex items-center justify-between">
                                            <div className="text-sm font-medium truncate">{f.name}</div>
                                            {edited[f.key] && (
                                                <div className="w-2 h-2 bg-orange-500 rounded-full ml-2 flex-shrink-0" title="File has been edited"></div>
                                            )}
                                        </div>
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
                        <div className="flex items-center gap-2 text-sm text-app-muted">
                            <span>Editing:</span>
                            <span className="text-app-text">{file.name}</span>
                            {edited[active] && (
                                <div className="flex items-center gap-1 text-orange-500">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                    <span className="text-xs">edited</span>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 items-center">
                            <button
                                className={`button ${edited[active] ? '!bg-orange-500 hover:!bg-orange-600 !text-white' : ''}`}
                                onClick={saveToDisk}
                            >
                                Save
                            </button>
                            <button className="button" onClick={download}>Download</button>
                        </div>
                    </div>
                    {error && <div className="text-rose-400 text-sm mb-2">{error}</div>}
                    <div className="border border-app-border rounded overflow-hidden">
                        <Editor
                            height="520px"
                            defaultLanguage="json"
                            language="json"
                            theme={theme === 'light' ? 'vs-light' : 'vs-dark'}
                            options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', scrollBeyondLastLine: false }}
                            value={val}
                            onChange={(value) => setContent(prev => ({ ...prev, [active]: value ?? '' }))}
                        />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-app-muted">Read-only viewer (no direct disk writes). Use Download or Save to persist changes. You need to explicitly click "Update Configuration" for changes in the configuration file and "Update Permissions" for changes in the other files, for these changes to take effect in Open-Edison. </div>
                        <div className="flex gap-2">
                            <button
                                className={`button text-xs px-2 py-1 ${updateFlags.needsPermissionUpdate[active] ? '!bg-orange-500 hover:!bg-orange-600 !text-white' : ''}`}
                                onClick={updatePermissions}
                            >
                                Update Permissions
                            </button>
                            <button
                                className={`button text-xs px-2 py-1 ${updateFlags.needsConfigUpdate[active] ? '!bg-orange-500 hover:!bg-orange-600 !text-white' : ''}`}
                                onClick={updateConfig}
                            >
                                Update Configuration
                            </button>
                        </div>
                    </div>
                    <div className="mt-3 border border-app-border rounded p-3 bg-app-bg/50">
                        <div className="text-sm font-semibold mb-1">About this file</div>
                        <p className="text-xs text-app-muted whitespace-pre-wrap">{file.description}</p>
                    </div>
                </div>
            </div>

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
        acl?: 'PUBLIC' | 'PRIVATE' | 'SECRET'
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
    // Single layout mode
    const [needsReinitialize, setNeedsReinitialize] = useState(false)

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
    const [backendApiKeyVisible, setBackendApiKeyVisible] = useState(false)
    const [backendApiKeyInput, setBackendApiKeyInput] = useState<string>('')
    const [savingBackendKey, setSavingBackendKey] = useState(false)

    // Removed tiles view; single layout only
    useEffect(() => {
        const k = (config as any)?.['edison-watch-api-key'] || ''
        setApiKeyInput(k)
    }, [config])
    useEffect(() => {
        const beKey = config?.server?.api_key || ''
        setBackendApiKeyInput(beKey)
    }, [config])

    // Copy API key from config to localStorage for authentication headers
    useEffect(() => {
        if (config?.server?.api_key) {
            try {
                localStorage.setItem('api_key', config.server.api_key)
            } catch { /* ignore */ }
        }
    }, [config])

    // Check localStorage for config update flag to make Reinitialize button orange
    useEffect(() => {
        const checkConfigUpdateFlag = () => {
            try {
                const configFlags = safeLocalStorage.getItem('json_editor_needs_config_update')
                if (configFlags) {
                    const flags = JSON.parse(configFlags)
                    setNeedsReinitialize(!!flags.config)
                }
            } catch { /* ignore */ }
        }

        checkConfigUpdateFlag()
        // Check periodically for changes from other components
        const interval = setInterval(checkConfigUpdateFlag, 1000)
        return () => clearInterval(interval)
    }, [])

    // Baselines for Save only changes
    const [origConfig, setOrigConfig] = useState<ConfigFile | null>(null)
    const [origToolPerms, setOrigToolPerms] = useState<ToolPerms | null>(null)
    const [origResourcePerms, setOrigResourcePerms] = useState<ResourcePerms | null>(null)
    const [origPromptPerms, setOrigPromptPerms] = useState<PromptPerms | null>(null)

    // Auto-save when permission data changes
    useEffect(() => {
        // Only trigger autosave if we have loaded data and there are actual changes
        console.log('🔄 Autosave useEffect triggered')
        console.log('🔄 toolPerms:', toolPerms)
        console.log('🔄 origToolPerms:', origToolPerms)

        if (toolPerms && origToolPerms) {
            const currentStr = JSON.stringify(toolPerms)
            const origStr = JSON.stringify(origToolPerms)
            console.log('🔄 Current JSON:', currentStr)
            console.log('🔄 Original JSON:', origStr)
            console.log('🔄 Are they different?', currentStr !== origStr)

            if (currentStr !== origStr) {
                console.log('🔄 Tool permissions changed, triggering autosave')
                // Add a small delay to ensure state is fully updated
                setTimeout(() => debouncedAutoSave(), 0)
            } else {
                console.log('🔄 No changes detected, skipping autosave')
            }
        } else {
            console.log('🔄 Missing data, skipping autosave')
        }
    }, [toolPerms, origToolPerms])

    useEffect(() => {
        if (resourcePerms && origResourcePerms && JSON.stringify(resourcePerms) !== JSON.stringify(origResourcePerms)) {
            debouncedAutoSave()
        }
    }, [resourcePerms, origResourcePerms])

    useEffect(() => {
        if (promptPerms && origPromptPerms && JSON.stringify(promptPerms) !== JSON.stringify(origPromptPerms)) {
            debouncedAutoSave()
        }
    }, [promptPerms, origPromptPerms])

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
                // Get API key with proper fallback order
                const storedKeyBulk = getApiKey()
                const headersBulk: Record<string, string> = { 'Cache-Control': 'no-cache' }
                if (storedKeyBulk) {
                    headersBulk['Authorization'] = `Bearer ${storedKeyBulk}`
                    console.log('Using API key for bulk request:', storedKeyBulk)
                } else {
                    console.log('No API key found for bulk request')
                }
                const [c, t, r, p] = await Promise.all([
                    fetch(`/@fs${projectRoot}/${CONFIG_NAME}`, { cache: 'no-cache', headers: headersBulk }),
                    fetch(`/@fs${projectRoot}/${TOOL_NAME}`, { cache: 'no-cache', headers: headersBulk }),
                    fetch(`/@fs${projectRoot}/${RESOURCE_NAME}`, { cache: 'no-cache', headers: headersBulk }),
                    fetch(`/@fs${projectRoot}/${PROMPT_NAME}`, { cache: 'no-cache', headers: headersBulk }),
                ])
                if (!c.ok || !t.ok || !r.ok || !p.ok) {
                    setError('Failed to load one or more JSON files. Ensure they exist or use Save to create them.')
                    return
                }
                const [cText, tText, rText, pText] = await Promise.all([c.text(), t.text(), r.text(), p.text()])
                if (!active) return
                // Derive server defaults prioritizing config.json servers, then add extras from permissions
                const configServers: string[] = Array.isArray((JSON.parse(cText) as any)?.mcp_servers)
                    ? ((JSON.parse(cText) as any).mcp_servers as Array<{ name: string }>).map((s) => String(s.name || '').trim())
                    : []
                const keysFrom = (obj: any) => Object.keys(obj || {}).filter((k) => k !== '_metadata' && k !== 'builtin')
                const permNames = new Set<string>([
                    ...keysFrom(JSON.parse(tText) as any),
                    ...keysFrom(JSON.parse(rText) as any),
                    ...keysFrom(JSON.parse(pText) as any),
                ].map((n) => String(n || '').trim()))

                // Start with config servers, in declared order
                const defsOrdered: MCPServerDefault[] = configServers.map((name) => ({
                    name,
                    tools: (JSON.parse(tText) as any)?.[name],
                    resources: (JSON.parse(rText) as any)?.[name],
                    prompts: (JSON.parse(pText) as any)?.[name],
                }))
                // Append permission-only servers not present in config
                for (const extra of Array.from(permNames)) {
                    if (!configServers.map((n) => n.toLowerCase()).includes(extra.toLowerCase())) {
                        defsOrdered.push({
                            name: extra,
                            tools: (JSON.parse(tText) as any)?.[extra],
                            resources: (JSON.parse(rText) as any)?.[extra],
                            prompts: (JSON.parse(pText) as any)?.[extra],
                        })
                    }
                }
                const defs: MCPServerDefault[] = defsOrdered
                setDefaults(defs)
                setConfig(JSON.parse(cText) as ConfigFile)
                setOrigConfig(JSON.parse(cText) as ConfigFile)
                setToolPerms(JSON.parse(tText) as ToolPerms)
                setResourcePerms(JSON.parse(rText) as ResourcePerms)
                setPromptPerms(JSON.parse(pText) as PromptPerms)
                setOrigToolPerms(JSON.parse(tText) as ToolPerms)
                setOrigResourcePerms(JSON.parse(rText) as ResourcePerms)
                setOrigPromptPerms(JSON.parse(pText) as PromptPerms)
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

        // Persist core permission flags and acl; drop any UI metadata like description
        const toCore = (f: any) => ({
            enabled: Boolean(f?.enabled),
            write_operation: Boolean(f?.write_operation),
            read_private_data: Boolean(f?.read_private_data),
            read_untrusted_public_data: Boolean(f?.read_untrusted_public_data),
            ...(f?.acl && { acl: f.acl }),
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
                        || Boolean((flags as any).acl)
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
            && a?.acl === b?.acl
    }

    function deepClone<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj))
    }

    // Removed unused upsertServer helper (replaced by inline logic in toggleServer)

    const toggleServer = async (srvName: string, enabled: boolean) => {
        try {
            // Compute next config state synchronously
            const currentList = [...(config?.mcp_servers || [])]
            const idx = currentList.findIndex(s => (s.name || '').trim().toLowerCase() === srvName.toLowerCase())
            const existing = idx >= 0 ? currentList[idx] : undefined
            const updated = {
                name: srvName,
                command: existing?.command ?? '',
                args: existing?.args ?? [],
                env: existing?.env ?? {},
                enabled,
                roots: existing?.roots ?? [],
            }
            const nextList = [...currentList]
            if (idx === -1) nextList.push(updated)
            else nextList[idx] = updated
            const nextCfg = { ...(config || { mcp_servers: [] } as any), mcp_servers: nextList }

            // Optimistically update UI
            setConfig(nextCfg as any)

            // Persist to backend immediately
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = getApiKey()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
            const resp = await fetch('/__save_json__', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: 'config.json', content: JSON.stringify(nextCfg, null, 4) })
            })
            if (!resp.ok) throw new Error('Save failed')
            // Update baseline on success so subsequent diffs are correct
            setOrigConfig(nextCfg as any)
            console.log(`✅ Auto-saved config.json after toggling ${srvName} to ${enabled}`)

            // Set config update flag in localStorage to make buttons orange
            try {
                const configFlags = safeLocalStorage.getItem('json_editor_needs_config_update')
                const flags = configFlags ? JSON.parse(configFlags) : {}
                flags.config = true
                localStorage.setItem('json_editor_needs_config_update', JSON.stringify(flags))
            } catch { /* ignore */ }
        } catch (e) {
            console.warn('⚠️ Failed to auto-save config.json on toggle:', e)
        }
    }

    // Removed setServerApiKey: API key defaults are no longer provided here

    const saveAll = async (onlyChanges: boolean) => {
        setSaving(true)
        setToast(null)
        try {
            const post = (name: string, content: string) => {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                const storedKey = getApiKey()
                if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
                return fetch('/__save_json__', { method: 'POST', headers, body: JSON.stringify({ name, content }) })
            }
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
                const headersPerm: Record<string, string> = { 'Content-Type': 'application/json' }
                const derivedApiKey = (config?.server?.api_key || '') as string
                if (derivedApiKey) headersPerm['Authorization'] = `Bearer ${derivedApiKey}`
                const cacheResponse = await fetch(`http://${serverHost}:${serverPort}/api/permissions-changed`, {
                    method: 'POST',
                    headers: headersPerm
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

            // Reset permission update flags in localStorage after autosave
            try {
                const permissionFlags = safeLocalStorage.getItem('json_editor_needs_permission_update')
                if (permissionFlags) {
                    const flags = JSON.parse(permissionFlags)
                    // Reset all permission file flags (tool, resource, prompt)
                    const resetFlags = { ...flags, tool: false, resource: false, prompt: false }
                    localStorage.setItem('json_editor_needs_permission_update', JSON.stringify(resetFlags))
                }
            } catch { /* ignore */ }
        } catch (e) {
            setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

    // Auto-save function that shows "Changes saved" message
    const autoSave = async () => {
        try {
            console.log('🔄 Starting autosave...')
            console.log('🔄 Before autosave - toolPerms:', toolPerms)
            console.log('🔄 Before autosave - origToolPerms:', origToolPerms)
            await saveAll(true)
            // Update the original state to match current state after successful save
            setOrigToolPerms(toolPerms)
            setOrigResourcePerms(resourcePerms)
            setOrigPromptPerms(promptPerms)
            console.log('🔄 After autosave - Updated origToolPerms to match current state')
            setToast({ message: 'Changes saved', type: 'success' })
        } catch (e) {
            // Don't show error toast for auto-save failures to avoid spam
            console.error('Auto-save failed:', e)
        }
    }

    // Debounced auto-save with 0.5 second delay
    const debouncedAutoSave = (() => {
        let timeoutId: NodeJS.Timeout | null = null
        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            timeoutId = setTimeout(() => {
                autoSave()
            }, 500) // 0.5 second delay
        }
    })()

    // Helper: fetch with timeout (used for long-running operations like reinitialize)
    async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal })
            return resp
        } finally {
            clearTimeout(id)
        }
    }

    const reinitializeServers = async () => {
        setSaving(true)
        setToast(null)
        try {
            // Step 1: Save configuration changes first
            console.log('🔄 Saving configuration changes...')
            const post = (name: string, content: string) => {
                const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                const storedKey = getApiKey()
                if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
                return fetch('/__save_json__', { method: 'POST', headers, body: JSON.stringify({ name, content }) })
            }

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
            setToast({ message: 'Saved. Reinitializing servers…', type: 'success' })

            // Step 2: Reinitialize MCP servers
            console.log('🔄 Reinitializing MCP servers...')
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            const storedKey = getApiKey()
            const apiKey = storedKey || config?.server?.api_key || ''
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`
            }

            const reinitResponse = await fetchWithTimeout(`/mcp/reinitialize`, {
                method: 'POST',
                headers
            }, 10_000)

            if (!reinitResponse.ok) {
                const errorData = await reinitResponse.json().catch(() => ({}))
                throw new Error(errorData.message || `Reinitialize failed (${reinitResponse.status})`)
            }

            const result = await reinitResponse.json()
            console.log('✅ MCP servers reinitialized successfully:', result)
            const count = result.total_final_mounted || 0
            const names = Array.isArray(result.mounted_servers) ? result.mounted_servers.join(', ') : ''
            setToast({ message: `Saved and reinitialized ${count} servers${names ? `: ${names}` : ''}`, type: 'success' })

            // Refresh OAuth status and tool schemas after successful reinitialization
            console.log('🔐 Refreshing OAuth status after reinitialization...')
            await loadOAuthStatus()
            // Refresh tool schemas (best effort)
            try {
                const schemas = await fetchToolSchemasExternal(projectRoot)
                TOOL_SCHEMAS = schemas
            } catch { /* ignore */ }

            // Reset config update flags in localStorage after manual save/reinitialize
            try {
                const configFlags = safeLocalStorage.getItem('json_editor_needs_config_update')
                if (configFlags) {
                    const flags = JSON.parse(configFlags)
                    // Reset config file flag
                    const resetFlags = { ...flags, config: false }
                    safeLocalStorage.setItem('json_editor_needs_config_update', JSON.stringify(resetFlags))
                }
            } catch { /* ignore */ }

        } catch (e) {
            console.error('❌ Failed to save and reinitialize:', e)
            const isAbort = (e as any)?.name === 'AbortError'
            const msg = isAbort ? 'Reinitialize timed out after 10s' : (e instanceof Error ? e.message : 'Save and reinitialize failed')
            setToast({ message: msg, type: 'error' })
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
            const storedKey = getApiKey()
            if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
            const resp = await fetch('/mcp/validate', { method: 'POST', headers, body: JSON.stringify(body) })
            const data = await resp.json() as any
            if (!resp.ok || data?.valid === false) {
                const msg = (data && typeof data.error === 'string') ? data.error : `Validate failed (${resp.status})`
                throw new Error(msg)
            }

            const toPerm = (desc?: string): PermissionFlags => ({ enabled: true, write_operation: true, read_private_data: true, read_untrusted_public_data: true, description: desc, acl: 'SECRET' } as PermissionFlags)

            setToolPerms(prev => {
                const next = { ...(prev || {}) } as any
                const server = next[serverName] || {}
                for (const t of data.tools || []) {
                    const key = unprefixByServer(String(t.name || ''), serverName)
                    if (!server[key]) server[key] = toPerm(t.description)
                }
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
                for (const p of data.prompts || []) {
                    const key = unprefixByServer(String(p.name || ''), serverName)
                    if (!server[key]) server[key] = toPerm(p.description)
                }
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
        await toggleServer(serverName, true)
        setToast({ message: 'Quick-start: imported permissions and enabled', type: 'success' })
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
            if (!externalKey || externalKey === 'change-me') {
                setToast({
                    message: 'Autoconfig requires an Edison Watch API key. Enter it in Configuration and try again.',
                    type: 'error'
                })
                return
            }
            headers['X-API-KEY'] = externalKey

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
                const hint = resp.status === 401
                    ? 'Autoconfig unauthorized. Check your Edison Watch API key.'
                    : ''
                setToast({
                    message: `Autoconfig failed (${resp.status})${hint ? ` - ${hint}` : (txt ? ` - ${txt}` : '')}`,
                    type: 'error'
                })
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
                        const key = unprefixByServer(String(name), serverName)
                        server[key] = flags
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
                        const key = unprefixByServer(String(name), serverName)
                        server[key] = flags
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

    const saveBackendApiKey = async () => {
        if (!config) return
        setSavingBackendKey(true)
        try {
            const nextCfg: any = { ...config, server: { ...config.server, api_key: backendApiKeyInput } }
            const resp = await fetch('/__save_json__', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'config.json', content: JSON.stringify(nextCfg, null, 4) })
            })
            if (!resp.ok) throw new Error('Save failed')
            setConfig(nextCfg)
            setOrigConfig(nextCfg)
            setToast({ message: 'Open Edison API key saved', type: 'success' })
        } catch (e) {
            setToast({ message: 'Failed to save Open Edison API key', type: 'error' })
        } finally {
            setSavingBackendKey(false)
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
                                                        console.log(`🔄 Toggle raw values: flags.enabled=${flags.enabled}, !!flags.enabled=${!!flags.enabled}, new value=${v}`)
                                                        console.log(`🔄 Toggle changed: ${groupName}.${itemName}.enabled = ${v}`)
                                                        console.log(`🔄 Current flags:`, flags)
                                                        setData((prev: any) => {
                                                            // Ensure we preserve all existing flags and only update the enabled property
                                                            const currentItem = prev[groupName]?.[itemName] || {}
                                                            const newData = {
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: {
                                                                        ...currentItem,
                                                                        enabled: v
                                                                    }
                                                                }
                                                            }
                                                            console.log(`🔄 New data for ${groupName}.${itemName}:`, newData[groupName][itemName])
                                                            return newData
                                                        })
                                                    }} />
                                                    <span>{flags.enabled ? 'Enabled' : 'Disabled'}</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-app-muted mt-1">{flags.description || 'No description provided'}</div>
                                            <div className="mt-2 grid grid-cols-1 gap-2">
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.write_operation} onChange={(e) => {
                                                        console.log(`🔄 Checkbox changed: ${groupName}.${itemName}.write_operation = ${e.target.checked}`)
                                                        setData((prev: any) => {
                                                            // Ensure we preserve all existing flags and only update the write_operation property
                                                            const currentItem = prev[groupName]?.[itemName] || {}
                                                            return {
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: {
                                                                        ...currentItem,
                                                                        write_operation: e.target.checked
                                                                    }
                                                                }
                                                            }
                                                        })
                                                    }} />
                                                    <span>write_operation</span>
                                                </label>
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.read_private_data} onChange={(e) => {
                                                        console.log(`🔄 Checkbox changed: ${groupName}.${itemName}.read_private_data = ${e.target.checked}`)
                                                        setData((prev: any) => {
                                                            // Ensure we preserve all existing flags and only update the read_private_data property
                                                            const currentItem = prev[groupName]?.[itemName] || {}
                                                            return {
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: {
                                                                        ...currentItem,
                                                                        read_private_data: e.target.checked
                                                                    }
                                                                }
                                                            }
                                                        })
                                                    }} />
                                                    <span>read_private_data</span>
                                                </label>
                                                <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                    <input type="checkbox" className="accent-blue-500" checked={!!flags.read_untrusted_public_data} onChange={(e) => {
                                                        console.log(`🔄 Checkbox changed: ${groupName}.${itemName}.read_untrusted_public_data = ${e.target.checked}`)
                                                        setData((prev: any) => {
                                                            // Ensure we preserve all existing flags and only update the read_untrusted_public_data property
                                                            const currentItem = prev[groupName]?.[itemName] || {}
                                                            return {
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: {
                                                                        ...currentItem,
                                                                        read_untrusted_public_data: e.target.checked
                                                                    }
                                                                }
                                                            }
                                                        })
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
                                                            console.log(`🔄 Select changed: ${groupName}.${itemName}.acl = ${val}`)
                                                            setData((prev: any) => {
                                                                // Ensure we preserve all existing flags and only update the acl property
                                                                const currentItem = prev[groupName]?.[itemName] || {}
                                                                return {
                                                                    ...prev,
                                                                    [groupName]: {
                                                                        ...prev[groupName],
                                                                        [itemName]: { ...currentItem, acl: val }
                                                                    }
                                                                }
                                                            })
                                                        }}
                                                    >
                                                        <option value="PUBLIC">PUBLIC</option>
                                                        <option value="PRIVATE">PRIVATE</option>
                                                        <option value="SECRET">SECRET</option>
                                                    </select>
                                                </div>
                                            </div>
                                            {/* Collapsible schemas for Tools only */}
                                            {title.toLowerCase().startsWith('tools') && (() => {
                                                const serverSchemas = TOOL_SCHEMAS[groupName] || {}
                                                const schemaEntry = serverSchemas[itemName] || null
                                                const pretty = (obj: unknown) => { try { return JSON.stringify(obj, null, 2) } catch { return String(obj ?? '') } }
                                                const copy = async (txt: string) => { try { await navigator.clipboard.writeText(txt) } catch { /* ignore */ } }
                                                return (
                                                    <>
                                                        {schemaEntry?.input_schema && (() => {
                                                            const summary = summarizeJsonSchema(schemaEntry.input_schema)
                                                            return (
                                                                <details className="mt-2">
                                                                    <summary className="text-xs cursor-pointer select-none text-app-muted">Input schema</summary>
                                                                    <div className="mt-2 relative">
                                                                        {summary ? (
                                                                            <div className="space-y-1">
                                                                                {summary.entries.map((e) => (
                                                                                    <div key={e.name} className="text-xs border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                                            <span className="font-mono">{e.name}</span>
                                                                                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-app-border bg-app-bg">{e.typeText}</span>
                                                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${e.optional ? 'text-app-muted border border-app-border' : 'bg-green-600 text-white'}`}>{e.optional ? 'optional' : 'required'}</span>
                                                                                        </div>
                                                                                        {e.description && <div className="mt-1 text-xs text-app-muted">{e.description}</div>}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="relative">
                                                                                <pre className="text-xs whitespace-pre overflow-auto max-h-48 border border-app-border rounded p-2 bg-app-bg/50">{pretty(schemaEntry.input_schema)}</pre>
                                                                                <button className="button absolute top-1 right-1 text-[10px] px-2 py-0.5" onClick={() => copy(pretty(schemaEntry.input_schema as any))}>Copy</button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </details>
                                                            )
                                                        })()}
                                                        {schemaEntry?.output_schema && (
                                                            <details className="mt-2">
                                                                <summary className="text-xs cursor-pointer select-none text-app-muted">Output schema</summary>
                                                                <div className="mt-2 relative">
                                                                    <pre className="text-xs whitespace-pre overflow-auto max-h-48 border border-app-border rounded p-2 bg-app-bg/50">{pretty(schemaEntry.output_schema)}</pre>
                                                                    <button className="button absolute top-1 right-1 text-[10px] px-2 py-0.5" onClick={() => copy(pretty(schemaEntry.output_schema as any))}>Copy</button>
                                                                </div>
                                                            </details>
                                                        )}
                                                    </>
                                                )
                                            })()}
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
                                                    console.log(`🔄 Toggle raw values (non-collapsible): flags.enabled=${flags.enabled}, !!flags.enabled=${!!flags.enabled}, new value=${v}`)
                                                    console.log(`🔄 Toggle changed (non-collapsible): ${groupName}.${itemName}.enabled = ${v}`)
                                                    console.log(`🔄 Current flags (non-collapsible):`, flags)
                                                    setData((prev: any) => {
                                                        // Ensure we preserve all existing flags and only update the enabled property
                                                        const currentItem = prev[groupName]?.[itemName] || {}
                                                        const newData = {
                                                            ...prev,
                                                            [groupName]: {
                                                                ...prev[groupName],
                                                                [itemName]: {
                                                                    ...currentItem,
                                                                    enabled: v
                                                                }
                                                            }
                                                        }
                                                        console.log(`🔄 New data for ${groupName}.${itemName} (non-collapsible):`, newData[groupName][itemName])
                                                        return newData
                                                    })
                                                }} />
                                                <span>{flags.enabled ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-app-muted mt-1">{flags.description || 'No description provided'}</div>
                                        <div className="mt-2 grid grid-cols-1 gap-2">
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.write_operation} onChange={(e) => {
                                                    console.log(`🔄 Checkbox changed (non-collapsible): ${groupName}.${itemName}.write_operation = ${e.target.checked}`)
                                                    setData((prev: any) => {
                                                        // Ensure we preserve all existing flags and only update the write_operation property
                                                        const currentItem = prev[groupName]?.[itemName] || {}
                                                        return {
                                                            ...prev,
                                                            [groupName]: {
                                                                ...prev[groupName],
                                                                [itemName]: {
                                                                    ...currentItem,
                                                                    write_operation: e.target.checked
                                                                }
                                                            }
                                                        }
                                                    })
                                                }} />
                                                <span>write_operation</span>
                                            </label>
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.read_private_data} onChange={(e) => {
                                                    console.log(`🔄 Checkbox changed (non-collapsible): ${groupName}.${itemName}.read_private_data = ${e.target.checked}`)
                                                    setData((prev: any) => {
                                                        // Ensure we preserve all existing flags and only update the read_private_data property
                                                        const currentItem = prev[groupName]?.[itemName] || {}
                                                        return {
                                                            ...prev,
                                                            [groupName]: {
                                                                ...prev[groupName],
                                                                [itemName]: {
                                                                    ...currentItem,
                                                                    read_private_data: e.target.checked
                                                                }
                                                            }
                                                        }
                                                    })
                                                }} />
                                                <span>read_private_data</span>
                                            </label>
                                            <label className="text-xs flex items-center gap-2 border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                <input type="checkbox" className="accent-blue-500" checked={!!flags.read_untrusted_public_data} onChange={(e) => {
                                                    console.log(`🔄 Checkbox changed (non-collapsible): ${groupName}.${itemName}.read_untrusted_public_data = ${e.target.checked}`)
                                                    setData((prev: any) => {
                                                        // Ensure we preserve all existing flags and only update the read_untrusted_public_data property
                                                        const currentItem = prev[groupName]?.[itemName] || {}
                                                        return {
                                                            ...prev,
                                                            [groupName]: {
                                                                ...prev[groupName],
                                                                [itemName]: {
                                                                    ...currentItem,
                                                                    read_untrusted_public_data: e.target.checked
                                                                }
                                                            }
                                                        }
                                                    })
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
                                                        console.log(`🔄 Select changed (non-collapsible): ${groupName}.${itemName}.acl = ${val}`)
                                                        setData((prev: any) => {
                                                            // Ensure we preserve all existing flags and only update the acl property
                                                            const currentItem = prev[groupName]?.[itemName] || {}
                                                            return {
                                                                ...prev,
                                                                [groupName]: {
                                                                    ...prev[groupName],
                                                                    [itemName]: { ...currentItem, acl: val }
                                                                }
                                                            }
                                                        })
                                                    }}
                                                >
                                                    <option value="PUBLIC">PUBLIC</option>
                                                    <option value="PRIVATE">PRIVATE</option>
                                                    <option value="SECRET">SECRET</option>
                                                </select>
                                            </div>
                                        </div>
                                        {/* Collapsible schemas for Tools only (non-collapsible inner layout) */}
                                        {title.toLowerCase().startsWith('tools') && (() => {
                                            const serverSchemas = TOOL_SCHEMAS[groupName] || {}
                                            const schemaEntry = serverSchemas[itemName] || null
                                            const pretty = (obj: unknown) => { try { return JSON.stringify(obj, null, 2) } catch { return String(obj ?? '') } }
                                            const copy = async (txt: string) => { try { await navigator.clipboard.writeText(txt) } catch { /* ignore */ } }
                                            return (
                                                <>
                                                    {schemaEntry?.input_schema && (() => {
                                                        const summary = summarizeJsonSchema(schemaEntry.input_schema)
                                                        return (
                                                            <details className="mt-2">
                                                                <summary className="text-xs cursor-pointer select-none text-app-muted">Input schema</summary>
                                                                <div className="mt-2 relative">
                                                                    {summary ? (
                                                                        <div className="space-y-1">
                                                                            {summary.entries.map((e) => (
                                                                                <div key={e.name} className="text-xs border border-app-border rounded px-2 py-1 bg-app-bg/50">
                                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                                        <span className="font-mono">{e.name}</span>
                                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-app-border bg-app-bg">{e.typeText}</span>
                                                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${e.optional ? 'text-app-muted border border-app-border' : 'bg-green-600 text-white'}`}>{e.optional ? 'optional' : 'required'}</span>
                                                                                    </div>
                                                                                    {e.description && <div className="mt-1 text-xs text-app-muted">{e.description}</div>}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="relative">
                                                                            <pre className="text-xs whitespace-pre overflow-auto max-h-48 border border-app-border rounded p-2 bg-app-bg/50">{pretty(schemaEntry.input_schema)}</pre>
                                                                            <button className="button absolute top-1 right-1 text-[10px] px-2 py-0.5" onClick={() => copy(pretty(schemaEntry.input_schema as any))}>Copy</button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </details>
                                                        )
                                                    })()}
                                                    {schemaEntry?.output_schema && (
                                                        <details className="mt-2">
                                                            <summary className="text-xs cursor-pointer select-none text-app-muted">Output schema</summary>
                                                            <div className="mt-2 relative">
                                                                <pre className="text-xs whitespace-pre overflow-auto max-h-48 border border-app-border rounded p-2 bg-app-bg/50">{pretty(schemaEntry.output_schema)}</pre>
                                                                <button className="button absolute top-1 right-1 text-[10px] px-2 py-0.5" onClick={() => copy(pretty(schemaEntry.output_schema as any))}>Copy</button>
                                                            </div>
                                                        </details>
                                                    )}
                                                </>
                                            )
                                        })()}
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
                        {/* Tiles view removed; single layout */}
                        <button
                            className={`button ${needsReinitialize ? '!bg-orange-500 hover:!bg-orange-600 !text-white' : ''}`}
                            disabled={saving}
                            onClick={reinitializeServers}
                        >
                            {saving ? 'Saving and reinitializing…' : 'Reinitialize'}
                        </button>

                    </div>
                </div>
                {true ? (
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
                                <div key={def.name} className="rounded p-3 bg-app-bg/50 border border-app-border">
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
                                const existing = (config?.mcp_servers || []).find(s => (s.name || '').trim().toLowerCase() === (def.name || '').trim().toLowerCase())
                                const enabled = !!existing?.enabled
                                const selected = selectedServer === def.name
                                return (
                                    <div key={def.name} className={`text-left border rounded p-3 transition-colors ${selected ? 'border-app-accent bg-app-accent/5' : 'border-app-border bg-app-bg/50 hover:bg-app-border/20'}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <button className="text-left" onClick={() => setSelectedServer(def.name)}>
                                                <div className="font-semibold">{def.name}</div>
                                                <div className="text-xs text-app-muted mt-0.5">Derived from permissions files</div>
                                            </button>
                                            <div className="flex items-center gap-2">
                                                <Toggle checked={enabled} onChange={(v) => toggleServer(def.name, v)} />
                                                <span className={`text-xs ${enabled ? 'text-blue-400' : 'text-app-muted'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        {selectedServer && (
                            <div className="mt-4 space-y-3">
                                {(() => {
                                    const serverName = selectedServer || ''
                                    const srv = (config?.mcp_servers || []).find(s => (s.name || '').trim().toLowerCase() === serverName.toLowerCase())
                                    const enabled = !!srv?.enabled
                                    return (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-app-muted">Server status</span>
                                            <Toggle checked={enabled} onChange={(v) => toggleServer(serverName, v)} />
                                            <span>{enabled ? 'Enabled' : 'Disabled'}</span>
                                        </div>
                                    )
                                })()}
                                {renderPermGroup(`Tools — ${selectedServer}`, filterPerms(toolPerms, selectedServer || ''), setToolPerms, false, false)}
                                {renderPermGroup(`Resources — ${selectedServer}`, filterPerms(resourcePerms, selectedServer || ''), setResourcePerms, false, false)}
                                {renderPermGroup(`Prompts — ${selectedServer}`, filterPerms(promptPerms, selectedServer || ''), setPromptPerms, false, false)}
                            </div>
                        )}
                    </>
                )}
                {/* Open Edison server API Key controls */}
                <div className="mt-3 border border-app-border rounded p-2 bg-app-bg/50">
                    <div className="text-xs text-app-muted mb-1">Open Edison server API key</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type={backendApiKeyVisible ? 'text' : 'password'}
                            className="button !py-1.5 !px-2 w-[260px]"
                            placeholder="Enter server API key"
                            value={backendApiKeyInput}
                            onChange={(e) => setBackendApiKeyInput(e.target.value)}
                        />
                        <button className="button" onClick={() => setBackendApiKeyVisible(v => !v)}>{backendApiKeyVisible ? 'Hide' : 'Show'}</button>
                        <button className="button" disabled={savingBackendKey} onClick={saveBackendApiKey}>{savingBackendKey ? 'Saving…' : 'Save key'}</button>
                    </div>
                </div>

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

            {
                <>
                    {renderPermGroup('Tools', toolPerms, setToolPerms, true, true)}
                    {renderPermGroup('Resources', resourcePerms, setResourcePerms, true, true)}
                    {renderPermGroup('Prompts', promptPerms, setPromptPerms, true, true)}
                </>
            }

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

function AgentsView({ sessions }: { sessions: (Session & { ts?: number; day?: string })[] }) {
    type Agent = { name: string; has_tool_overrides: boolean; has_prompt_overrides: boolean; has_resource_overrides: boolean }
    const [agents, setAgents] = useState<Agent[]>([])
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
    const [sessionLimit, setSessionLimit] = useState<number>(25)
    const [currentPage, setCurrentPage] = useState<number>(1)
    const [startDay, setStartDay] = useState<string>('')
    const [endDay, setEndDay] = useState<string>('')

    // Load agents list from API
    useEffect(() => {
        const loadAgents = async () => {
            try {
                const apiKey = getApiKey()
                const headers: Record<string, string> = {}
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
                const resp = await fetch('/api/agents', { headers })
                if (!resp.ok) return
                const data = await resp.json()
                const agentList = data.agents || []
                setAgents(agentList)
                // Auto-select first agent if available
                if (agentList.length > 0 && !selectedAgent) {
                    setSelectedAgent(agentList[0].name)
                }
            } catch { /* ignore */ }
        }
        loadAgents()
    }, [])

    // Compute stats for each agent from sessions
    const agentStats = useMemo(() => {
        const stats = new Map<string, { sessionCount: number; callCount: number; lastActive: number }>()
        console.log(`[AgentsView] Computing stats from ${sessions.length} sessions`)
        for (const s of sessions) {
            const name = s.agent_name
            console.log(`[AgentsView] Session ${s.session_id}: agent_name=${name}`)
            if (!name) continue // Skip sessions without agent
            const existing = stats.get(name) || { sessionCount: 0, callCount: 0, lastActive: 0 }
            existing.sessionCount += 1
            existing.callCount += s.tool_calls.length
            const ts = s.created_at || s.tool_calls[0]?.timestamp
            if (ts) {
                const t = Date.parse(ts)
                if (!Number.isNaN(t) && t > existing.lastActive) existing.lastActive = t
            }
            stats.set(name, existing)
        }
        console.log(`[AgentsView] Stats computed:`, Array.from(stats.entries()))
        return stats
    }, [sessions])

    // Filter sessions by selected agent and date range
    const agentSessions = useMemo(() => {
        if (!selectedAgent) return []
        let filtered = sessions.filter(s => s.agent_name === selectedAgent)

        // Apply date range filter
        if (startDay || endDay) {
            filtered = filtered.filter(s => {
                const day = (s as any).day as string | undefined
                if (!day) return false
                if (startDay && day < startDay) return false
                if (endDay && day > endDay) return false
                return true
            })
        }

        return filtered
    }, [sessions, selectedAgent, startDay, endDay])

    // Pagination
    const totalPages = Math.ceil(agentSessions.length / sessionLimit)
    const paginatedSessions = useMemo(() => {
        const start = (currentPage - 1) * sessionLimit
        return agentSessions.slice(start, start + sessionLimit)
    }, [agentSessions, currentPage, sessionLimit])

    // Reset to page 1 when agent or filters change
    useEffect(() => {
        setCurrentPage(1)
    }, [selectedAgent, startDay, endDay, sessionLimit])

    if (agents.length === 0) {
        return (
            <div className="card text-center text-app-muted">
                No agents configured. Create agent folders in `&lt;config_dir&gt;/agents/`
            </div>
        )
    }

    return (
        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>
            {/* Sidebar with agent list */}
            <div className="space-y-2">
                <div className="text-sm font-semibold mb-2 px-2">Agents</div>
                {agents.map(agent => {
                    const stats = agentStats.get(agent.name) || { sessionCount: 0, callCount: 0, lastActive: 0 }
                    const selected = selectedAgent === agent.name
                    return (
                        <button
                            key={agent.name}
                            className={`w-full text-left card transition-all active:scale-95 ${selected ? 'border-app-accent bg-app-accent/10' : 'hover:bg-app-border/20'}`}
                            onClick={() => setSelectedAgent(agent.name)}
                        >
                            <div className="font-semibold text-sm mb-1">{agent.name}</div>
                            <div className="text-xs space-y-0.5">
                                <div className="flex justify-between text-app-muted">
                                    <span>Sessions:</span>
                                    <span>{stats.sessionCount}</span>
                                </div>
                                <div className="flex justify-between text-app-muted">
                                    <span>Calls:</span>
                                    <span>{stats.callCount}</span>
                                </div>
                            </div>
                            {agent.has_tool_overrides && (
                                <div className="mt-2">
                                    <span className="badge text-[10px]">Overrides</span>
                                </div>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Main area with agent dashboard */}
            <div className="space-y-4">
                {selectedAgent ? (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-bold">{selectedAgent}</h2>
                                <span className="text-sm text-app-muted">
                                    ({agentSessions.length} sessions, {agentSessions.reduce((acc, s) => acc + s.tool_calls.length, 0)} calls)
                                </span>
                            </div>
                        </div>
                        <DateRangeSlider
                            sessions={sessions.filter(s => s.agent_name === selectedAgent)}
                            startTimeLabel={startDay}
                            endTimeLabel={endDay}
                            onTimeRangeChange={(s, e) => { setStartDay(s); setEndDay(e) }}
                        />
                        <Kpis sessions={agentSessions} />
                        <AgentDataflow sessions={agentSessions as any} />
                        <Stats sessions={agentSessions} />
                        <div className="card">
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-sm font-semibold">Sessions</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-app-muted">Per page:</span>
                                    <select
                                        className="button text-xs"
                                        value={sessionLimit}
                                        onChange={(e) => setSessionLimit(Number(e.target.value))}
                                    >
                                        <option value={10}>10</option>
                                        <option value={25}>25</option>
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                    </select>
                                </div>
                            </div>
                            <SessionTable sessions={paginatedSessions} />
                            <div className="flex items-center justify-between mt-3">
                                <div className="text-xs text-app-muted">
                                    Showing {Math.min((currentPage - 1) * sessionLimit + 1, agentSessions.length)}-{Math.min(currentPage * sessionLimit, agentSessions.length)} of {agentSessions.length} sessions
                                </div>
                                {totalPages > 1 && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="button text-xs"
                                            disabled={currentPage === 1}
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        >
                                            Previous
                                        </button>
                                        <span className="text-xs text-app-muted">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <button
                                            className="button text-xs"
                                            disabled={currentPage === totalPages}
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="card text-center text-app-muted">
                        Select an agent from the sidebar
                    </div>
                )}
            </div>
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

