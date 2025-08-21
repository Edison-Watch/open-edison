"""
OAuth Configuration Classes for OpenEdison MCP Gateway

Extends the configuration system to support OAuth-specific settings
and server metadata for MCP servers requiring authentication.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class OAuthConfig:
    """OAuth-specific configuration for an MCP server."""
    
    required: bool = False
    """Whether this server requires OAuth authentication."""
    
    scopes: Optional[List[str]] = None
    """OAuth scopes to request for this server."""
    
    client_name: str = "OpenEdison MCP Gateway"
    """Client name to use during OAuth registration."""
    
    auto_refresh: bool = True
    """Whether to automatically refresh expired tokens."""
    
    timeout_seconds: float = 30.0
    """Timeout for OAuth operations in seconds."""


@dataclass
class OAuthRuntimeStatus:
    """Runtime OAuth status for an MCP server."""
    
    status: str = "unknown"
    """Current OAuth status: unknown, not_required, needs_auth, authenticated, error, expired."""
    
    last_check: Optional[str] = None
    """Timestamp of last OAuth status check."""
    
    error_message: Optional[str] = None
    """Error message if OAuth failed."""
    
    token_expires_at: Optional[str] = None
    """When the current access token expires."""
    
    has_refresh_token: bool = False
    """Whether we have a refresh token for this server."""
    
    metadata_discovered: bool = False
    """Whether OAuth metadata was successfully discovered."""


@dataclass
class ServerOAuthMetadata:
    """OAuth metadata discovered from an MCP server."""
    
    authorization_endpoint: Optional[str] = None
    token_endpoint: Optional[str] = None
    scopes_supported: Optional[List[str]] = None
    response_types_supported: Optional[List[str]] = None
    grant_types_supported: Optional[List[str]] = None
    token_endpoint_auth_methods_supported: Optional[List[str]] = None
    
    @classmethod
    def from_discovery(cls, metadata: Dict[str, Any]) -> "ServerOAuthMetadata":
        """Create metadata from OAuth discovery response."""
        return cls(
            authorization_endpoint=metadata.get("authorization_endpoint"),
            token_endpoint=metadata.get("token_endpoint"),
            scopes_supported=metadata.get("scopes_supported"),
            response_types_supported=metadata.get("response_types_supported"),
            grant_types_supported=metadata.get("grant_types_supported"),
            token_endpoint_auth_methods_supported=metadata.get(
                "token_endpoint_auth_methods_supported"
            ),
        )


@dataclass
class OAuthServerPreset:
    """Preset OAuth configuration for well-known MCP servers."""
    
    server_pattern: str
    """Pattern to match server names or URLs."""
    
    display_name: str
    """Human-readable name for this server type."""
    
    default_scopes: List[str]
    """Default OAuth scopes for this server type."""
    
    client_name: str = "OpenEdison MCP Gateway"
    """Default client name for this server type."""
    
    description: str = ""
    """Description of this server type and its capabilities."""
    
    documentation_url: Optional[str] = None
    """URL to documentation for setting up OAuth with this server."""


# Preset configurations for common OAuth-enabled MCP servers
OAUTH_SERVER_PRESETS: List[OAuthServerPreset] = [
    OAuthServerPreset(
        server_pattern="google_drive",
        display_name="Google Drive",
        default_scopes=[
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive.file"
        ],
        description="Access Google Drive files and folders",
        documentation_url="https://developers.google.com/drive/api/guides/api-specific-auth"
    ),
    OAuthServerPreset(
        server_pattern="github",
        display_name="GitHub",
        default_scopes=["repo", "user:email"],
        description="Access GitHub repositories and user information",
        documentation_url="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps"
    ),
    OAuthServerPreset(
        server_pattern="microsoft",
        display_name="Microsoft Graph",
        default_scopes=[
            "https://graph.microsoft.com/Files.ReadWrite",
            "https://graph.microsoft.com/User.Read"
        ],
        description="Access Microsoft 365 files and user information",
        documentation_url="https://docs.microsoft.com/en-us/graph/auth/"
    ),
    OAuthServerPreset(
        server_pattern="slack",
        display_name="Slack",
        default_scopes=["channels:read", "chat:write", "users:read"],
        description="Access Slack channels and send messages",
        documentation_url="https://api.slack.com/authentication/oauth-v2"
    ),
    OAuthServerPreset(
        server_pattern="notion",
        display_name="Notion",
        default_scopes=["read", "insert", "update"],
        description="Access and modify Notion pages and databases",
        documentation_url="https://developers.notion.com/docs/authorization"
    ),
]


def get_oauth_preset(server_name: str) -> Optional[OAuthServerPreset]:
    """
    Get OAuth preset configuration for a server name.
    
    Args:
        server_name: Name of the MCP server
        
    Returns:
        Matching OAuthServerPreset, or None if no preset matches
    """
    server_name_lower = server_name.lower()
    
    for preset in OAUTH_SERVER_PRESETS:
        if preset.server_pattern.lower() in server_name_lower:
            return preset
    
    return None


def suggest_oauth_scopes(server_name: str) -> List[str]:
    """
    Suggest OAuth scopes for a server based on its name.
    
    Args:
        server_name: Name of the MCP server
        
    Returns:
        List of suggested OAuth scopes
    """
    preset = get_oauth_preset(server_name)
    if preset:
        return preset.default_scopes
    
    # Generic fallback scopes
    return ["read", "write"]


def get_oauth_documentation_url(server_name: str) -> Optional[str]:
    """
    Get OAuth documentation URL for a server.
    
    Args:
        server_name: Name of the MCP server
        
    Returns:
        Documentation URL, or None if not available
    """
    preset = get_oauth_preset(server_name)
    return preset.documentation_url if preset else None