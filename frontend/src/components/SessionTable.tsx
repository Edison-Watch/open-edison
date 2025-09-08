import React, { useState } from 'react'
import type { Session } from '../types'

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function shortenMiddle(value: string, head: number = 6, tail: number = 4): string {
  if (!value) return ''
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function getSecurityFlags(summary: Record<string, unknown> | undefined): {
  privateData: boolean; untrusted: boolean; external: boolean
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
  label: 'Low' | 'Medium' | 'High'; colorClass: string
} {
  const count = Number(flags.privateData) + Number(flags.untrusted) + Number(flags.external)
  if (count >= 2) return { label: 'High', colorClass: 'text-rose-400' }
  if (count === 1) return { label: 'Medium', colorClass: 'text-amber-400' }
  return { label: 'Low', colorClass: 'text-green-400' }
}

export function SessionTable({ sessions }: { sessions: Session[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const getHighestAcl = (summary: Record<string, unknown> | undefined): 'PUBLIC' | 'PRIVATE' | 'SECRET' => {
    const s: any = summary || {}
    const acl = s.acl || {}
    const level = (acl.highest_acl_level || acl.level || '').toString().toUpperCase()
    if (level === 'PRIVATE' || level === 'SECRET' || level === 'PUBLIC') return level
    return 'PUBLIC'
  }
  const aclBadge = (level: 'PUBLIC' | 'PRIVATE' | 'SECRET') => {
    const color = level === 'SECRET' ? 'text-rose-400' : level === 'PRIVATE' ? 'text-amber-400' : 'text-green-400'
    return <span className={color}>{level}</span>
  }
  return (
    <div className="card">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Date/Time</th>
            <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Session</th>
            <th colSpan={3} className="border-b border-app-border py-1 text-center text-xs text-app-muted align-bottom">Data access</th>
            <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">Risk</th>
            <th rowSpan={2} className="border-b border-app-border py-2 text-left align-bottom">ACL</th>
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
            const firstTs = s.created_at || s.tool_calls[0]?.timestamp
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
                  <td className="border-b border-app-border py-2">
                    {aclBadge(getHighestAcl(s.data_access_summary as any))}
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


