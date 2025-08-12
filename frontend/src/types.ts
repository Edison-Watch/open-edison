export type ToolCall = {
  id: string
  tool_name: string
  parameters: Record<string, unknown>
  timestamp: string
  duration_ms?: number | null
  status?: string
  result?: unknown
}

export type Session = {
  session_id: string
  correlation_id: string
  tool_calls: ToolCall[]
  data_access_summary: Record<string, unknown>
}

export type SessionsResponse = { sessions: Session[] }

export type PermissionFlags = {
  enabled: boolean
  write_operation: boolean
  read_private_data: boolean
  read_untrusted_public_data: boolean
  description?: string
}


