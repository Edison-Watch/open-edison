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
  created_at?: string | null
  tool_calls: ToolCall[]
  data_access_summary: Record<string, unknown>
}

export type SessionsResponse = { sessions: Session[] }

export type PermissionFlags = {
  enabled: boolean
  write_operation: boolean
  read_private_data: boolean
  read_untrusted_public_data: boolean
  acl?: 'PUBLIC' | 'PRIVATE' | 'SECRET'
  description?: string
}

export type OAuthStatus =
  | 'unknown'
  | 'not_required'
  | 'needs_auth'
  | 'authenticated'
  | 'error'
  | 'expired'

export type OAuthServerInfo = {
  server_name: string
  mcp_url?: string
  status: OAuthStatus
  error_message?: string | null
  token_expires_at?: string | null
  has_refresh_token: boolean
  scopes?: string[] | null
  client_name?: string
}

export type OAuthStatusResponse = {
  oauth_status: Record<string, OAuthServerInfo>
}

export type OAuthAuthorizeRequest = {
  scopes?: string[]
  client_name?: string
}

export type OAuthAuthorizeResponse = {
  status: 'authorization_started'
  message: string
  server_name: string
}

export type OAuthClearTokensResponse = {
  status: 'success'
  message: string
  server_name: string
}

export type OAuthRefreshResponse = {
  status: 'refreshed'
  server_name: string
  oauth_status: OAuthStatus
  error_message?: string | null
  token_expires_at?: string | null
  has_refresh_token: boolean
  scopes?: string[] | null
}


export type ToolSchemaEntry = {
  input_schema?: unknown | null
  output_schema?: unknown | null
}

export type ToolSchemasResponse = {
  tool_schemas: Record<string, Record<string, ToolSchemaEntry>>
}


