import { useMemo, useState, useEffect } from 'react'
import { useFlowsBackground } from '../hooks'
import { Panel } from './Panel'
import { NetworkDataflowGraph } from './NetworkDataflowGraph'
import DateRangeSlider from './DateRangeSlider'
import type { Session } from '../types'

// Helper function to format IP with hostname
function formatIpWithHostname(ip: string, hostname: string | null, port: number): string {
    if (hostname && hostname.trim()) {
        return `${hostname} (${ip}:${port})`
    }
    return `${ip}:${port}`
}

export function NetworkView() {
    // Use the same path resolution as sessions.db
    const flowsDbRelativePath = '/flows.db'
    const flowsDbAbsolutePath = (globalThis as any).__PROJECT_ROOT__
        ? `${(globalThis as any).__PROJECT_ROOT__}${flowsDbRelativePath}`
        : `${window.location.pathname}${flowsDbRelativePath}`

    // Date range state - same pattern as observability page
    const [startDay, setStartDay] = useState<string>('')
    const [endDay, setEndDay] = useState<string>('')
    const [rangeMs, setRangeMs] = useState<{ start: number; end: number } | null>(null)
    const [debouncedRangeMs, setDebouncedRangeMs] = useState<{ start: number; end: number } | null>(null)

    // Store the selected time range to persist across reloads
    const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number; end: number } | null>(() => {
        try {
            const saved = localStorage.getItem('network_selected_time_range')
            if (saved) {
                const parsed = JSON.parse(saved)
                if (parsed && typeof parsed.start === 'number' && typeof parsed.end === 'number') {
                    return parsed
                }
            }
        } catch {
            // Ignore localStorage errors
        }
        return null
    })

    // Save selected time range to localStorage
    useEffect(() => {
        if (selectedTimeRange) {
            try {
                localStorage.setItem('network_selected_time_range', JSON.stringify(selectedTimeRange))
            } catch {
                // Ignore localStorage errors
            }
        }
    }, [selectedTimeRange])

    // Get all flows (unfiltered) for DateRangeSlider to show full timeline - same pattern as observability
    const { data: allData } = useFlowsBackground(`${flowsDbAbsolutePath}`)
    const allFlows = useMemo(() => allData?.flows ?? [], [allData])

    // Debounce the range changes to avoid interrupting dragging
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedRangeMs(rangeMs)
        }, 300) // 300ms delay after dragging stops

        return () => clearTimeout(timer)
    }, [rangeMs])

    const { data, loading, error } = useFlowsBackground(`${flowsDbAbsolutePath}`, debouncedRangeMs?.start, debouncedRangeMs?.end)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
    const [selectedFlows, setSelectedFlows] = useState<Set<string>>(new Set())

    const flows = useMemo(() => data?.flows ?? [], [data])

    // Create a stable flows reference that only changes when the actual data content changes
    const stableFlows = useMemo(() => {
        if (flows.length === 0) return flows
        // Create a stable reference by sorting and creating a new array only when content changes
        return [...flows].sort((a, b) => {
            // Sort by timestamp, then by src_ip, then by dst_ip for consistency
            const timeA = parseInt(a.timestamp)
            const timeB = parseInt(b.timestamp)
            if (timeA !== timeB) return timeB - timeA // Most recent first
            if (a.src_ip !== b.src_ip) return a.src_ip.localeCompare(b.src_ip)
            return a.dst_ip.localeCompare(b.dst_ip)
        })
    }, [flows.length, flows.map(f => `${f.src_ip}-${f.dst_ip}-${f.timestamp}-${f.is_ai_provider}`).join('|')])


    // Track last update time
    useEffect(() => {
        if (data) {
            setLastUpdate(new Date())
        }
    }, [data])

    // Create minimal session data for DateRangeSlider bounds - just for time range calculation
    const sliderData = useMemo(() => {
        if (allFlows.length === 0) {
            // If no flows, create a default range for the last 7 days
            const now = Date.now()
            const weekAgo = now - (7 * 24 * 60 * 60 * 1000)
            return [{
                session_id: 'default-range',
                correlation_id: 'default-range',
                agent_name: 'Default',
                tool_calls: [{
                    id: 'default-call',
                    tool_name: 'Default',
                    parameters: {},
                    timestamp: weekAgo.toString(),
                    duration_ms: 0,
                    result: null
                }],
                created_at: weekAgo.toString(),
                data_access_summary: {},
                day: new Date(weekAgo).toISOString().slice(0, 10)
            }] as (Session & { day: string })[]
        }

        // Use actual flow timestamps to create bounds
        const timestamps = allFlows.map(f => Date.parse(f.timestamp)).filter(t => !isNaN(t))
        if (timestamps.length === 0) return []

        const minTs = Math.min(...timestamps)

        return [{
            session_id: 'flow-bounds',
            correlation_id: 'flow-bounds',
            agent_name: 'Flow Bounds',
            tool_calls: [{
                id: 'bounds-call',
                tool_name: 'Bounds',
                parameters: {},
                timestamp: minTs.toString(),
                duration_ms: 0,
                result: null
            }],
            created_at: minTs.toString(),
            data_access_summary: {},
            day: new Date(minTs).toISOString().slice(0, 10)
        }] as (Session & { day: string })[]
    }, [allFlows.length]) // Only depend on data availability


    // Pagination state
    const [currentPage, setCurrentPage] = useState(1)
    const [flowsPerPage, setFlowsPerPage] = useState(25)
    const totalPages = Math.ceil(flows.length / flowsPerPage)

    const paginatedFlows = useMemo(() => {
        const start = (currentPage - 1) * flowsPerPage
        return flows.slice(start, start + flowsPerPage)
    }, [flows, currentPage, flowsPerPage])

    // Reset to page 1 when flows change
    useEffect(() => {
        setCurrentPage(1)
    }, [flows.length])

    // Compute statistics using the same dataset and filtering as DateRangeSlider
    const stats = useMemo(() => {
        // Use allFlows and filter by the current slider range, just like DateRangeSlider does
        const [a, b] = selectedTimeRange ? [selectedTimeRange.start, selectedTimeRange.end] : [0, Date.now()]
        const filteredFlows = allFlows.filter(flow => {
            const t = Date.parse(flow.timestamp)
            if (Number.isNaN(t)) return false
            return t >= a && t <= b
        })

        const totalFlows = filteredFlows.length
        const aiFlows = filteredFlows.filter(f => f.is_ai_provider === 1)
        // Treat AI provider flows as API requests since they represent API calls to AI services
        const apiRequests = filteredFlows.filter(f => f.is_api_request === 1 || f.is_ai_provider === 1)
        const totalBytes = filteredFlows.reduce((sum, f) => sum + f.bidirectional_bytes, 0)
        const aiBytes = aiFlows.reduce((sum, f) => sum + f.bidirectional_bytes, 0)

        // Provider breakdown
        const providerStats = new Map<string, { count: number; bytes: number; apiRequests: number }>()
        aiFlows.forEach(flow => {
            const provider = flow.provider_id || 'Unknown'
            const existing = providerStats.get(provider) || { count: 0, bytes: 0, apiRequests: 0 }
            existing.count += 1
            existing.bytes += flow.bidirectional_bytes
            // Count AI provider flows as API requests
            if (flow.is_api_request === 1 || flow.is_ai_provider === 1) existing.apiRequests += 1
            providerStats.set(provider, existing)
        })

        // Protocol breakdown
        const protocolStats = new Map<string, { count: number; bytes: number }>()
        filteredFlows.forEach(flow => {
            const proto = flow.protocol
            const existing = protocolStats.get(proto) || { count: 0, bytes: 0 }
            existing.count += 1
            existing.bytes += flow.bidirectional_bytes
            protocolStats.set(proto, existing)
        })

        return {
            totalFlows,
            aiFlows: aiFlows.length,
            apiRequests: apiRequests.length,
            totalBytes,
            aiBytes,
            providerStats: Array.from(providerStats.entries()).map(([provider, stats]) => ({
                provider,
                ...stats
            })).sort((a, b) => b.bytes - a.bytes),
            protocolStats: Array.from(protocolStats.entries()).map(([protocol, stats]) => ({
                protocol,
                ...stats
            })).sort((a, b) => b.bytes - a.bytes)
        }
    }, [allFlows, selectedTimeRange])

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
    }

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms.toFixed(0)}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="text-center text-app-muted">Loading network data...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="space-y-4">
                <div className="card p-4 text-red-500">
                    <h3 className="font-semibold mb-2">Error loading network data</h3>
                    <p className="text-sm">{error}</p>
                    <p className="text-xs mt-2 text-app-muted">
                        Make sure to run 'make test' in agent_detector to capture traffic and create the symlink.
                    </p>
                </div>
            </div>
        )
    }

    // Don't return early for empty flows - show the full UI with empty state cards
    const hasNoDataAtAll = allFlows.length === 0
    if (hasNoDataAtAll) {
        return (
            <div className="space-y-4">
                <div className="card p-4 text-center text-app-muted">
                    <h3 className="font-semibold mb-2">No network data available</h3>
                    <p className="text-sm">
                        Run 'make test' in the agent_detector directory to start capturing network traffic.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Subtle refresh indicator */}
            {lastUpdate && (
                <div className="text-xs text-app-muted text-right">
                    Last updated: {lastUpdate.toLocaleTimeString()}
                    {loading && <span className="ml-2 text-blue-500">⟳</span>}
                </div>
            )}

            {/* Date range selector - flows-focused */}
            <DateRangeSlider
                sessions={sliderData}
                startTimeLabel={startDay}
                endTimeLabel={endDay}
                onTimeRangeChange={(s: string, e: string) => { setStartDay(s); setEndDay(e) }}
                onTimeRangeMsChange={(s, e) => {
                    const newRange = { start: s, end: e }
                    setRangeMs(newRange)
                    setSelectedTimeRange(newRange) // Store the selected range
                }}
                itemLabel="flows"
                value={selectedTimeRange ? [selectedTimeRange.start, selectedTimeRange.end] : undefined}
                onChange={(value) => {
                    const newRange = { start: value[0], end: value[1] }
                    setSelectedTimeRange(newRange)
                    setRangeMs(newRange)
                }}
                flowsData={allFlows.map(f => ({ timestamp: f.timestamp, is_ai_provider: f.is_ai_provider }))}
            />

            {/* Overview Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="card flex items-center gap-3">
                    <div>
                        <div className="text-xs text-app-muted">Total Flows</div>
                        <div className="text-xl font-bold">{stats.totalFlows.toLocaleString()}</div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div>
                        <div className="text-xs text-app-muted">AI Provider Flows</div>
                        <div className="text-xl font-bold text-blue-500">{stats.aiFlows.toLocaleString()}</div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div>
                        <div className="text-xs text-app-muted">API Requests</div>
                        <div className="text-xl font-bold text-green-500">{stats.apiRequests.toLocaleString()}</div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div>
                        <div className="text-xs text-app-muted">Total Data</div>
                        <div className="text-xl font-bold">{formatBytes(stats.totalBytes)}</div>
                    </div>
                </div>
            </div>

            {/* Network Performance Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="card flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    </div>
                    <div>
                        <div className="text-xs text-app-muted">Avg Flow Duration</div>
                        <div className="text-xl font-bold">
                            {flows.length > 0 ? formatDuration(flows.reduce((acc, f) => acc + f.bidirectional_duration_ms, 0) / flows.length) : '0ms'}
                        </div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    </div>
                    <div>
                        <div className="text-xs text-app-muted">Avg Flow Size</div>
                        <div className="text-xl font-bold">
                            {flows.length > 0 ? formatBytes(flows.reduce((acc, f) => acc + f.bidirectional_bytes, 0) / flows.length) : '0 B'}
                        </div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                    </div>
                    <div>
                        <div className="text-xs text-app-muted">Unique Sources</div>
                        <div className="text-xl font-bold">
                            {new Set(flows.map(f => f.src_ip)).size}
                        </div>
                    </div>
                </div>
                <div className="card flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    </div>
                    <div>
                        <div className="text-xs text-app-muted">Unique Destinations</div>
                        <div className="text-xl font-bold">
                            {new Set(flows.map(f => f.dst_ip)).size}
                        </div>
                    </div>
                </div>
            </div>

            {/* AI Providers and Protocols - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* AI Provider Breakdown */}
                <Panel title="AI Providers" subtitle="Traffic by detected AI service">
                    {stats.providerStats.length > 0 ? (
                        <div className="space-y-3">
                            {stats.providerStats.map(({ provider, count, bytes, apiRequests }) => (
                                <div key={provider} className="flex items-center justify-between p-3 bg-app-bg-secondary rounded">
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                                        <div>
                                            <div className="font-semibold">{provider.toUpperCase()}</div>
                                            <div className="text-xs text-app-muted">
                                                {count} flows • {apiRequests} API requests
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold">{formatBytes(bytes)}</div>
                                        <div className="text-xs text-app-muted">
                                            {((bytes / stats.aiBytes) * 100).toFixed(1)}% of AI traffic
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-app-muted py-8">
                            No AI provider traffic in selected range
                        </div>
                    )}
                </Panel>

                {/* Protocol Breakdown */}
                <Panel title="Protocols" subtitle="Traffic by network protocol">
                    {stats.protocolStats.length > 0 ? (
                        <div className="space-y-3">
                            {stats.protocolStats.map(({ protocol, count, bytes }) => (
                                <div key={protocol} className="flex items-center justify-between p-3 bg-app-bg-secondary rounded">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${protocol === 'HTTPS' ? 'bg-green-500' :
                                            protocol === 'HTTP' ? 'bg-blue-500' :
                                                protocol === 'DNS' ? 'bg-purple-500' :
                                                    'bg-gray-500'
                                            }`}></div>
                                        <div>
                                            <div className="font-semibold">{protocol}</div>
                                            <div className="text-xs text-app-muted">{count} flows</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-semibold">{formatBytes(bytes)}</div>
                                        <div className="text-xs text-app-muted">
                                            {((bytes / stats.totalBytes) * 100).toFixed(1)}% of total
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-app-muted py-8">
                            No protocol traffic in selected range
                        </div>
                    )}
                </Panel>
            </div>


            {/* Network Dataflow Graph */}
            <NetworkDataflowGraph
                flows={stableFlows}
                onSelectedFlowsChange={setSelectedFlows}
            />

            {/* Recent API Requests */}
            <Panel title="Recent API Requests" subtitle="Latest HTTPS requests to AI providers">
                {stats.apiRequests > 0 ? (
                    <div className="space-y-2">
                        {allFlows
                            .filter(flow => {
                                const t = Date.parse(flow.timestamp)
                                if (Number.isNaN(t)) return false
                                const [a, b] = selectedTimeRange ? [selectedTimeRange.start, selectedTimeRange.end] : [0, Date.now()]
                                return t >= a && t <= b && (flow.is_api_request === 1 || flow.is_ai_provider === 1)
                            })
                            .slice(0, 10)
                            .map((flow, index) => (
                                <div key={index} className="flex items-center justify-between p-2 bg-app-bg-secondary rounded text-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                        <div>
                                            <div className="font-semibold">
                                                {flow.provider_id?.toUpperCase() || 'UNKNOWN'}
                                                {flow.correlated_dns_domain && (
                                                    <span className="text-app-muted ml-2">→ {flow.correlated_dns_domain}</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-app-muted">
                                                {flow.src_ip}:{flow.src_port} → {flow.dst_ip}:{flow.dst_port}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right text-xs">
                                        <div>{formatBytes(flow.src2dst_bytes)} → {formatBytes(flow.dst2src_bytes)}</div>
                                        <div className="text-app-muted">{formatDuration(flow.bidirectional_duration_ms)}</div>
                                    </div>
                                </div>
                            ))}
                    </div>
                ) : (
                    <div className="text-center text-app-muted py-8">
                        No API requests in selected range
                    </div>
                )}
            </Panel>

            {/* All Flows Table */}
            <Panel title="All Network Flows" subtitle="Complete flow data from nfstream" heightRem={32}>
                <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold">Network Flows</div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-app-muted">Per page:</span>
                        <select
                            className="button text-xs"
                            value={flowsPerPage}
                            onChange={(e) => setFlowsPerPage(Number(e.target.value))}
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="table w-full text-sm">
                        <thead className="sticky top-0 bg-app-bg z-10">
                            <tr className="border-b border-app-border">
                                <th className="px-4 py-3 text-left font-semibold">Time</th>
                                <th className="px-4 py-3 text-left font-semibold">Protocol</th>
                                <th className="px-4 py-3 text-left font-semibold">Source</th>
                                <th className="px-4 py-3 text-left font-semibold">Destination</th>
                                <th className="px-4 py-3 text-left font-semibold">Provider</th>
                                <th className="px-4 py-3 text-left font-semibold">Bytes</th>
                                <th className="px-4 py-3 text-left font-semibold">Duration</th>
                                <th className="px-4 py-3 text-left font-semibold">Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedFlows.map((flow, index) => {
                                // Create a unique identifier for this flow
                                const flowId = `${flow.src_ip}:${flow.src_port}-${flow.dst_ip}:${flow.dst_port}-${flow.timestamp}`
                                const isSelected = selectedFlows.has(flowId)

                                return (
                                    <tr
                                        key={index}
                                        className={isSelected ? 'bg-app-accent/5 border-l-2 border-app-accent' : ''}
                                        onClick={() => {
                                            // Toggle selection of this flow
                                            const newSelectedFlows = new Set(selectedFlows)
                                            if (isSelected) {
                                                newSelectedFlows.delete(flowId)
                                            } else {
                                                newSelectedFlows.add(flowId)
                                            }
                                            setSelectedFlows(newSelectedFlows)
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <td className="px-4 py-3 font-mono text-sm">
                                            {new Date(flow.timestamp).toLocaleTimeString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-sm ${flow.protocol === 'HTTPS' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                                flow.protocol === 'HTTP' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                                                    flow.protocol === 'DNS' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                                                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                                                }`}>
                                                {flow.protocol}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-sm">{formatIpWithHostname(flow.src_ip, flow.src_hostname, flow.src_port)}</td>
                                        <td className="px-4 py-3 font-mono text-sm">{formatIpWithHostname(flow.dst_ip, flow.dst_hostname, flow.dst_port)}</td>
                                        <td className="px-4 py-3">
                                            {flow.is_ai_provider === 1 ? (
                                                <span className="px-2 py-1 rounded text-sm bg-blue-100 text-blue-800">
                                                    {flow.provider_id?.toUpperCase() || 'AI'}
                                                </span>
                                            ) : (
                                                <span className="text-app-muted">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-sm">{formatBytes(flow.bidirectional_bytes)}</td>
                                        <td className="px-4 py-3 font-mono text-sm">{formatDuration(flow.bidirectional_duration_ms)}</td>
                                        <td className="px-4 py-3">
                                            {flow.is_api_request === 1 ? (
                                                <span className="px-2 py-1 rounded text-sm bg-green-100 text-green-800">
                                                    API
                                                </span>
                                            ) : flow.is_ai_provider === 1 ? (
                                                <span className="px-2 py-1 rounded text-sm bg-blue-100 text-blue-800">
                                                    AI
                                                </span>
                                            ) : (
                                                <span className="text-app-muted">—</span>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between mt-3">
                    <div className="text-xs text-app-muted">
                        Showing {Math.min((currentPage - 1) * flowsPerPage + 1, flows.length)}-{Math.min(currentPage * flowsPerPage, flows.length)} of {flows.length} flows
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
            </Panel>
        </div>
    )
}
