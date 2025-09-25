/**
 * Service for making API calls to the Setup Wizard API server
 */

const SETUP_WIZARD_API_BASE_URL = 'http://localhost:3002';

export interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  roots?: string[];
  client?: string; // Track which client this server came from
}

export interface ImportRequest {
  clients: string[];
  dry_run?: boolean;
  skip_oauth?: boolean;
}

export interface ImportResponse {
  success: boolean;
  servers: ServerConfig[];
  errors: string[];
  message: string;
}

export interface ClientDetectionResponse {
  success: boolean;
  clients: string[];
  message: string;
}

export interface VerificationRequest {
  servers: ServerConfig[];
}

export interface VerificationResponse {
  success: boolean;
  results: Record<string, boolean>;
  message: string;
}

export interface OAuthRequest {
  server: ServerConfig;
}

export interface OAuthResponse {
  success: boolean;
  message: string;
}

export interface ExportRequest {
  clients: string[];
  url?: string;
  api_key?: string;
  server_name?: string;
  dry_run?: boolean;
  force?: boolean;
}

export interface ExportResponse {
  success: boolean;
  results: Record<string, any>;
  message: string;
}

export interface ReplaceRequest {
  clients: string[];
  url?: string;
  api_key?: string;
  server_name?: string;
  dry_run?: boolean;
  force?: boolean;
  create_if_missing?: boolean;
}

export interface ReplaceResponse {
  success: boolean;
  results: Record<string, any>;
  message: string;
}

export interface BackupInfoResponse {
  success: boolean;
  backups: Record<string, any>;
  message: string;
}

export interface RestoreRequest {
  clients: string[];
  server_name?: string;
  dry_run?: boolean;
}

export interface RestoreResponse {
  success: boolean;
  results: Record<string, any>;
  message: string;
}

export interface SaveRequest {
  servers: ServerConfig[];
  dry_run?: boolean;
}

export interface SaveResponse {
  success: boolean;
  message: string;
  config_path?: string;
}

export interface ConfigResponse {
  success: boolean;
  config?: any;
  config_path?: string;
  message?: string;
}

class WizardApiService {
  private baseUrl: string;

  constructor(baseUrl: string = SETUP_WIZARD_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Check if the MCP API server is healthy
   */
  async healthCheck(): Promise<{ status: string; service: string }> {
    return this.makeRequest('/health');
  }

  /**
   * Detect available MCP clients on the system
   */
  async detectClients(): Promise<ClientDetectionResponse> {
    return this.makeRequest('/clients');
  }

  /**
   * Import MCP servers from specified clients
   */
  async importServers(request: ImportRequest): Promise<ImportResponse> {
    return this.makeRequest('/import', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Verify MCP server configurations
   */
  async verifyServers(request: VerificationRequest): Promise<VerificationResponse> {
    return this.makeRequest('/verify', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Authorize OAuth for a remote MCP server
   */
  async authorizeOAuth(request: OAuthRequest): Promise<OAuthResponse> {
    return this.makeRequest('/oauth', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Save imported servers to Open Edison configuration
   */
  async saveServers(request: SaveRequest): Promise<SaveResponse> {
    return this.makeRequest('/save', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Export Open Edison configuration to specified clients
   */
  async exportToClients(request: ExportRequest): Promise<ExportResponse> {
    return this.makeRequest('/export', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Replace existing MCP server configurations with Open Edison
   */
  async replaceMcpServers(request: ReplaceRequest): Promise<ReplaceResponse> {
    return this.makeRequest('/replace', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get backup information for all clients
   */
  async getBackupInfo(): Promise<BackupInfoResponse> {
    return this.makeRequest('/backups');
  }

  /**
   * Restore original MCP configurations for specified clients
   */
  async restoreClients(request: RestoreRequest): Promise<RestoreResponse> {
    return this.makeRequest('/restore', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get current Open Edison configuration
   */
  async getConfig(): Promise<ConfigResponse> {
    return this.makeRequest('/config');
  }
}

// Export a singleton instance
export const wizardApiService = new WizardApiService();
export default wizardApiService;
