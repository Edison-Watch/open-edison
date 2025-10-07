import { useMemo, useState, useEffect } from 'react'
import { useFlows } from '../hooks'
import { Panel } from './Panel'
import { NetworkDataflowGraph } from './NetworkDataflowGraph'
import DateRangeSlider from './DateRangeSlider'
import type { Session } from '../types'

export function NetworkView() {
    // Use the same path resolution as sessions.db
    const flowsDbRelativePath = '/flows.db'
    const flowsDbAbsolutePath = (globalThis as any).__PROJECT_ROOT__
        ? `${(globalThis as any).__PROJECT_ROOT__}${flowsDbRelativePath}`
        : `${window.location.pathname}${flowsDbRelativePath}`

    // Date range state
    const [startDay, setStartDay] = useState<string>('')
    const [endDay, setEndDay] = useState<string>('')
    const [startTimeMs, setStartTimeMs] = useState<number | undefined>(undefined)
    const [endTimeMs, setEndTimeMs] = useState<number | undefined>(undefined)

    const { data, loading, error } = useFlows(flowsDbAbsolutePath, startTimeMs, endTimeMs)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
    const [selectedFlows, setSelectedFlows] = useState<Set<string>>(new Set())

    const flows = useMemo(() => data?.flows ?? [], [data])

    // Track last update time
    useEffect(() => {
        if (data) {
            setLastUpdate(new Date())
        }
    }, [data])

    // Convert flows to session-like format for DateRangeSlider
    const mockSessions = useMemo(() => {
        return flows.map((flow, index) => ({
            session_id: `flow-${index}`,
            correlation_id: `flow-${index}`,
            agent_name: 'Network Flow',
            tool_calls: [{
                id: `flow-${index}-call`,
                tool_name: flow.protocol,
                parameters: {},
                timestamp: flow.timestamp,
                duration_ms: flow.bidirectional_duration_ms,
                result: null
            }],
            created_at: flow.timestamp,
            data_access_summary: {},
            day: new Date(parseInt(flow.timestamp)).toISOString().slice(0, 10)
        } as Session & { day: string }))
    }, [flows])

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1)
    const flowsPerPage = 50
    const totalPages = Math.ceil(flows.length / flowsPerPage)

    const paginatedFlows = useMemo(() => {
        const start = (currentPage - 1) * flowsPerPage
        return flows.slice(start, start + flowsPerPage)
    }, [flows, currentPage, flowsPerPage])

    // Reset to page 1 when flows change
    useEffect(() => {
        setCurrentPage(1)
    }, [flows.length])

    // Compute statistics
    const stats = useMemo(() => {
        const totalFlows = flows.length
        const aiFlows = flows.filter(f => f.is_ai_provider === 1)
        const apiRequests = flows.filter(f => f.is_api_request === 1)
        const totalBytes = flows.reduce((sum, f) => sum + f.bidirectional_bytes, 0)
        const aiBytes = aiFlows.reduce((sum, f) => sum + f.bidirectional_bytes, 0)

        // Provider breakdown
        const providerStats = new Map<string, { count: number; bytes: number; apiRequests: number }>()
        aiFlows.forEach(flow => {
            const provider = flow.provider_id || 'Unknown'
            const existing = providerStats.get(provider) || { count: 0, bytes: 0, apiRequests: 0 }
            existing.count += 1
            existing.bytes += flow.bidirectional_bytes
            if (flow.is_api_request === 1) existing.apiRequests += 1
            providerStats.set(provider, existing)
        })

        // Protocol breakdown
        const protocolStats = new Map<string, { count: number; bytes: number }>()
        flows.forEach(flow => {
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
    }, [flows])

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

    if (flows.length === 0) {
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

            {/* Date Range Filter */}
            <DateRangeSlider
                sessions={mockSessions}
                startTimeLabel={startDay}
                endTimeLabel={endDay}
                onTimeRangeChange={(s: string, e: string) => {
                    setStartDay(s);
                    setEndDay(e)
                }}
                onTimeRangeMsChange={(startMs: number, endMs: number) => {
                    setStartTimeMs(startMs)
                    setEndTimeMs(endMs)
                }}
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
                {stats.providerStats.length > 0 && (
                    <Panel title="AI Providers" subtitle="Traffic by detected AI service">
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
                    </Panel>
                )}

                {/* Protocol Breakdown */}
                <Panel title="Protocols" subtitle="Traffic by network protocol">
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
                </Panel>
            </div>

            {/* Recent API Requests */}
            {flows.filter(f => f.is_api_request === 1).length > 0 && (
                <Panel title="Recent API Requests" subtitle="Latest HTTPS requests to AI providers">
                    <div className="space-y-2">
                        {flows
                            .filter(f => f.is_api_request === 1)
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
                </Panel>
            )}

            {/* Network Dataflow Graph */}
            <NetworkDataflowGraph
                flows={flows}
                onSelectedFlowsChange={setSelectedFlows}
            />

            {/* All Flows Table */}
            <Panel title="All Network Flows" subtitle="Complete flow data from nfstream">
                <div className="overflow-x-auto">
                    <table className="table w-full text-sm">
                        <thead>
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
                                        <td className="px-4 py-3 font-mono text-sm">{flow.src_ip}:{flow.src_port}</td>
                                        <td className="px-4 py-3 font-mono text-sm">{flow.dst_ip}:{flow.dst_port}</td>
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
                <div className="flex items-center justify-between mt-4 px-4">
                    <div className="text-sm text-app-muted">
                        Showing {Math.min((currentPage - 1) * flowsPerPage + 1, flows.length)}-{Math.min(currentPage * flowsPerPage, flows.length)} of {flows.length} flows
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-3">
                            <button
                                className="button text-sm px-3 py-1"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            >
                                Previous
                            </button>
                            <span className="text-sm text-app-muted">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                className="button text-sm px-3 py-1"
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
