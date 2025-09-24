import { useEffect, useState } from 'react'
import initSqlJs from 'sql.js'
import type { SessionsResponse, Session } from './types'

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
        const storedKey = (() => { try { return localStorage.getItem('api_key') || '' } catch { return '' } })()
        const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
        if (storedKey) headers['Authorization'] = `Bearer ${storedKey}`
        const fileResp = await fetch(`/@fs${dbPath}`, {
          cache: 'no-cache',
          headers
        })
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
    return () => {
      active = false
    }
  }, [dbPath])

  return { data, loading, error }
}


