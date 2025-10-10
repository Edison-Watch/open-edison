import { useEffect, useState, useCallback, useRef } from 'react'
import initSqlJs from 'sql.js'
import type { SessionsResponse, Session } from './types'

export type FlowData = {
  run_id: string
  timestamp: string
  src_ip: string
  src_hostname: string | null
  dst_ip: string
  dst_hostname: string | null
  src_port: number
  dst_port: number
  protocol: string
  bidirectional_packets: number
  src2dst_packets: number
  dst2src_packets: number
  bidirectional_bytes: number
  src2dst_bytes: number
  dst2src_bytes: number
  bidirectional_duration_ms: number
  bidirectional_min_ps: number
  bidirectional_max_ps: number
  bidirectional_mean_ps: number
  is_ai_provider: number
  provider_id: string | null
  is_api_request: number
  correlated_dns_domain: string | null
}

export type FlowsResponse = { flows: FlowData[] }

export function useFlowsStatic(dbPath: string, startTimeMs?: number, endTimeMs?: number) {
  const [data, setData] = useState<FlowsResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const fetchFlows = async () => {
      if (!active) return

      setLoading(true)
      setError(null)
      try {
        const SQL = await initSqlJs({ locateFile: (f: string) => `https://sql.js.org/dist/${f}` })
        // Get API key from localStorage (for autonomous operation), global variable, or URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlApiKey = urlParams.get('api_key');
        const globalApiKey = (window as any).OPEN_EDISON_API_KEY;
        const storedKey = (() => {
          try {
            return localStorage.getItem('api_key') || globalApiKey || urlApiKey || ''
          } catch {
            return globalApiKey || urlApiKey || ''
          }
        })()
        const headers: Record<string, string> = {}
        if (storedKey) {
          headers['Authorization'] = `Bearer ${storedKey}`
          console.log('Using API key for flows request:', storedKey)
        } else {
          console.log('No API key found for flows request')
        }

        // Add timestamp to prevent caching
        const timestamp = Date.now()
        const fileResp = await fetch(`/@fs${dbPath}?t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            ...headers,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        })
        if (!fileResp.ok) throw new Error(`Cannot read flows DB at ${dbPath}`)
        const buf = new Uint8Array(await fileResp.arrayBuffer())
        const db = new SQL.Database(buf as any as BufferSource)

        // Query flows data with AI provider detection and time filtering
        let query = `
          SELECT run_id, timestamp, src_ip, src_hostname, dst_ip, dst_hostname, src_port, dst_port, protocol,
                 bidirectional_packets, src2dst_packets, dst2src_packets,
                 bidirectional_bytes, src2dst_bytes, dst2src_bytes,
                 bidirectional_duration_ms, bidirectional_min_ps, bidirectional_max_ps, bidirectional_mean_ps,
                 is_ai_provider, provider_id, is_api_request, correlated_dns_domain
          FROM flows 
        `

        // Add time filtering if provided
        const conditions = []
        if (startTimeMs !== undefined) {
          conditions.push(`strftime('%s', timestamp) * 1000 >= ${startTimeMs}`)
        }
        if (endTimeMs !== undefined) {
          conditions.push(`strftime('%s', timestamp) * 1000 <= ${endTimeMs}`)
        }

        if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(' AND ')}`
        }

        query += ` ORDER BY timestamp DESC LIMIT 1000`
        const result = db.exec(query)
        console.log('🔍 hooks.ts: Database query executed, result length:', result.length)
        const flows: FlowData[] = []
        if (result.length > 0) {
          const cols = result[0].columns
          const rows = result[0].values
          for (const row of rows) {
            const record: any = {}
            cols.forEach((c: string, i: number) => (record[c] = row[i]))
            flows.push({
              run_id: String(record.run_id),
              timestamp: String(record.timestamp),
              src_ip: String(record.src_ip),
              src_hostname: record.src_hostname && record.src_hostname !== 'null' ? record.src_hostname : null,
              dst_ip: String(record.dst_ip),
              dst_hostname: record.dst_hostname && record.dst_hostname !== 'null' ? record.dst_hostname : null,
              src_port: Number(record.src_port),
              dst_port: Number(record.dst_port),
              protocol: String(record.protocol),
              bidirectional_packets: Number(record.bidirectional_packets),
              src2dst_packets: Number(record.src2dst_packets),
              dst2src_packets: Number(record.dst2src_packets),
              bidirectional_bytes: Number(record.bidirectional_bytes),
              src2dst_bytes: Number(record.src2dst_bytes),
              dst2src_bytes: Number(record.dst2src_bytes),
              bidirectional_duration_ms: Number(record.bidirectional_duration_ms),
              bidirectional_min_ps: Number(record.bidirectional_min_ps),
              bidirectional_max_ps: Number(record.bidirectional_max_ps),
              bidirectional_mean_ps: Number(record.bidirectional_mean_ps),
              is_ai_provider: Number(record.is_ai_provider),
              provider_id: record.provider_id || null,
              is_api_request: Number(record.is_api_request),
              correlated_dns_domain: record.correlated_dns_domain || null,
            })
          }
        }
        if (active) setData({ flows })
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        if (active) setLoading(false)
      }
    }

    // Initial fetch only - no auto-refresh
    void fetchFlows()

    return () => {
      active = false
    }
  }, [dbPath, startTimeMs, endTimeMs])

  return { data, loading, error }
}

export function useFlows(dbPath: string, startTimeMs?: number, endTimeMs?: number) {
  const [data, setData] = useState<FlowsResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const fetchFlows = async () => {
      if (!active) return

      setLoading(true)
      setError(null)
      try {
        const SQL = await initSqlJs({ locateFile: (f: string) => `https://sql.js.org/dist/${f}` })
        // Get API key from localStorage (for autonomous operation), global variable, or URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlApiKey = urlParams.get('api_key');
        const globalApiKey = (window as any).OPEN_EDISON_API_KEY;
        const storedKey = (() => {
          try {
            return localStorage.getItem('api_key') || globalApiKey || urlApiKey || ''
          } catch {
            return globalApiKey || urlApiKey || ''
          }
        })()
        const headers: Record<string, string> = {}
        if (storedKey) {
          headers['Authorization'] = `Bearer ${storedKey}`
          console.log('Using API key for flows request:', storedKey)
        } else {
          console.log('No API key found for flows request')
        }

        // Add timestamp to prevent caching
        const timestamp = Date.now()
        const fileResp = await fetch(`/@fs${dbPath}?t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            ...headers,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        })
        if (!fileResp.ok) throw new Error(`Cannot read flows DB at ${dbPath}`)
        const buf = new Uint8Array(await fileResp.arrayBuffer())
        const db = new SQL.Database(buf as any as BufferSource)

        // Query flows data with AI provider detection and time filtering
        let query = `
          SELECT run_id, timestamp, src_ip, src_hostname, dst_ip, dst_hostname, src_port, dst_port, protocol,
                 bidirectional_packets, src2dst_packets, dst2src_packets,
                 bidirectional_bytes, src2dst_bytes, dst2src_bytes,
                 bidirectional_duration_ms, bidirectional_min_ps, bidirectional_max_ps, bidirectional_mean_ps,
                 is_ai_provider, provider_id, is_api_request, correlated_dns_domain
          FROM flows 
        `

        // Add time filtering if provided
        const conditions = []
        if (startTimeMs !== undefined) {
          conditions.push(`strftime('%s', timestamp) * 1000 >= ${startTimeMs}`)
        }
        if (endTimeMs !== undefined) {
          conditions.push(`strftime('%s', timestamp) * 1000 <= ${endTimeMs}`)
        }

        if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(' AND ')}`
        }

        query += ` ORDER BY timestamp DESC LIMIT 1000`
        const result = db.exec(query)
        console.log('🔍 hooks.ts: Database query executed, result length:', result.length)
        const flows: FlowData[] = []
        if (result.length > 0) {
          const cols = result[0].columns
          const rows = result[0].values
          for (const row of rows) {
            const record: any = {}
            cols.forEach((c: string, i: number) => (record[c] = row[i]))
            flows.push({
              run_id: String(record.run_id),
              timestamp: String(record.timestamp),
              src_ip: String(record.src_ip),
              src_hostname: record.src_hostname && record.src_hostname !== 'null' ? record.src_hostname : null,
              dst_ip: String(record.dst_ip),
              dst_hostname: record.dst_hostname && record.dst_hostname !== 'null' ? record.dst_hostname : null,
              src_port: Number(record.src_port),
              dst_port: Number(record.dst_port),
              protocol: String(record.protocol),
              bidirectional_packets: Number(record.bidirectional_packets),
              src2dst_packets: Number(record.src2dst_packets),
              dst2src_packets: Number(record.dst2src_packets),
              bidirectional_bytes: Number(record.bidirectional_bytes),
              src2dst_bytes: Number(record.src2dst_bytes),
              dst2src_bytes: Number(record.dst2src_bytes),
              bidirectional_duration_ms: Number(record.bidirectional_duration_ms),
              bidirectional_min_ps: Number(record.bidirectional_min_ps),
              bidirectional_max_ps: Number(record.bidirectional_max_ps),
              bidirectional_mean_ps: Number(record.bidirectional_mean_ps),
              is_ai_provider: Number(record.is_ai_provider),
              provider_id: record.provider_id || null,
              is_api_request: Number(record.is_api_request),
              correlated_dns_domain: record.correlated_dns_domain || null,
            })
          }
        }
        if (active) setData({ flows })
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        if (active) setLoading(false)
      }
    }

    // Initial fetch only - no auto-refresh
    void fetchFlows()

    return () => {
      active = false
    }
  }, [dbPath, startTimeMs, endTimeMs])

  return { data, loading, error }
}

export function useFlowsBackground(dbPath: string, startTimeMs?: number, endTimeMs?: number) {
  const [data, setData] = useState<FlowsResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)
  const dataRef = useRef<FlowsResponse | null>(null)

  const fetchFlows = useCallback(async () => {
    setError(null)
    try {
      const SQL = await initSqlJs({ locateFile: (f: string) => `https://sql.js.org/dist/${f}` })
      // Get API key from localStorage (for autonomous operation), global variable, or URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const urlApiKey = urlParams.get('api_key');
      const globalApiKey = (window as any).OPEN_EDISON_API_KEY;
      const storedKey = (() => {
        try {
          return localStorage.getItem('api_key') || globalApiKey || urlApiKey || ''
        } catch {
          return globalApiKey || urlApiKey || ''
        }
      })()
      const headers: Record<string, string> = {}
      if (storedKey) {
        headers['Authorization'] = `Bearer ${storedKey}`
      }

      // Add timestamp to prevent caching
      const timestamp = Date.now()
      const fileResp = await fetch(`/@fs${dbPath}?t=${timestamp}`, {
        cache: 'no-store',
        headers: {
          ...headers,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
      if (!fileResp.ok) throw new Error(`Cannot read flows DB at ${dbPath}`)
      const buf = new Uint8Array(await fileResp.arrayBuffer())
      const db = new SQL.Database(buf as any as BufferSource)

      // Query flows data with AI provider detection and time filtering
      let query = `
        SELECT run_id, timestamp, src_ip, src_hostname, dst_ip, dst_hostname, src_port, dst_port, protocol,
               bidirectional_packets, src2dst_packets, dst2src_packets,
               bidirectional_bytes, src2dst_bytes, dst2src_bytes,
               bidirectional_duration_ms, bidirectional_min_ps, bidirectional_max_ps, bidirectional_mean_ps,
               is_ai_provider, provider_id, is_api_request, correlated_dns_domain
        FROM flows
      `

      // Add time filtering if provided
      const conditions = []
      if (startTimeMs !== undefined) {
        conditions.push(`strftime('%s', timestamp) * 1000 >= ${startTimeMs}`)
      }
      if (endTimeMs !== undefined) {
        conditions.push(`strftime('%s', timestamp) * 1000 <= ${endTimeMs}`)
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
      }

      query += ` ORDER BY timestamp DESC LIMIT 1000`
      const result = db.exec(query)
      const flows: FlowData[] = []
      if (result.length > 0) {
        const cols = result[0].columns
        const rows = result[0].values
        for (const row of rows) {
          const record: any = {}
          cols.forEach((c: string, i: number) => (record[c] = row[i]))
          flows.push({
            run_id: String(record.run_id),
            timestamp: String(record.timestamp),
            src_ip: String(record.src_ip),
            src_hostname: record.src_hostname && record.src_hostname !== 'null' ? record.src_hostname : null,
            dst_ip: String(record.dst_ip),
            dst_hostname: record.dst_hostname && record.dst_hostname !== 'null' ? record.dst_hostname : null,
            src_port: Number(record.src_port),
            dst_port: Number(record.dst_port),
            protocol: String(record.protocol),
            bidirectional_packets: Number(record.bidirectional_packets),
            src2dst_packets: Number(record.src2dst_packets),
            dst2src_packets: Number(record.dst2src_packets),
            bidirectional_bytes: Number(record.bidirectional_bytes),
            src2dst_bytes: Number(record.src2dst_bytes),
            dst2src_bytes: Number(record.dst2src_bytes),
            bidirectional_duration_ms: Number(record.bidirectional_duration_ms),
            bidirectional_min_ps: Number(record.bidirectional_min_ps),
            bidirectional_max_ps: Number(record.bidirectional_max_ps),
            bidirectional_mean_ps: Number(record.bidirectional_mean_ps),
            is_ai_provider: Number(record.is_ai_provider),
            provider_id: record.provider_id || null,
            is_api_request: Number(record.is_api_request),
            correlated_dns_domain: record.correlated_dns_domain || null,
          })
        }
      }

      const newData = { flows }

      // Only update state if data has actually changed
      const dataChanged = !dataRef.current ||
        dataRef.current.flows.length !== newData.flows.length ||
        JSON.stringify(dataRef.current.flows) !== JSON.stringify(newData.flows)

      if (dataChanged) {
        dataRef.current = newData
        setData(newData)
        setLastUpdate(new Date())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (isInitialLoadRef.current) {
        setLoading(false)
        isInitialLoadRef.current = false
      }
    }
  }, [dbPath, startTimeMs, endTimeMs])

  useEffect(() => {
    // Initial fetch
    void fetchFlows()

    // Set up background refresh every 5 seconds
    refreshIntervalRef.current = setInterval(() => {
      void fetchFlows()
    }, 5000)

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
    }
  }, [fetchFlows])

  return { data, loading, error, lastUpdate }
}

export function useSessions(dbPath: string) {
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
        // Get API key from localStorage (for autonomous operation), global variable, or URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlApiKey = urlParams.get('api_key');
        const globalApiKey = (window as any).OPEN_EDISON_API_KEY;
        const storedKey = (() => {
          try {
            return localStorage.getItem('api_key') || globalApiKey || urlApiKey || ''
          } catch {
            return globalApiKey || urlApiKey || ''
          }
        })()
        const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
        if (storedKey) {
          headers['Authorization'] = `Bearer ${storedKey}`
          console.log('Using API key for sessions request:', storedKey)
        } else {
          console.log('No API key found for sessions request')
        }
        const fileResp = await fetch(`/@fs${dbPath}`, {
          cache: 'no-cache',
          headers
        })
        if (!fileResp.ok) throw new Error(`Cannot read DB at ${dbPath}`)
        const buf = new Uint8Array(await fileResp.arrayBuffer())
        const db = new SQL.Database(buf as any as BufferSource)
        const query = `SELECT session_id, correlation_id, tool_calls, data_access_summary, agent_name, agent_type FROM mcp_sessions ORDER BY id DESC LIMIT 200;`
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
              agent_name: record.agent_name || null,
              agent_type: record.agent_type || null,
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
    return () => {
      active = false
    }
  }, [dbPath])

  return { data, loading, error }
}


