"""
OAuth Manager for OpenEdison MCP Gateway

Handles OAuth 2.1 authentication for MCP servers using FastMCP's built-in OAuth support.
Provides detection, token management, and authentication flow coordination.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path

from fastmcp.client.auth.oauth import (
    FileTokenStorage,
    OAuth,
    check_if_auth_required,
    default_cache_dir,
)
from loguru import logger as log

from src.oauth_override import OpenEdisonOAuth


class OAuthStatus(Enum):
    """OAuth authentication status for MCP servers."""

    UNKNOWN = "unknown"  # noqa
    NOT_REQUIRED = "not_required"
    NEEDS_AUTH = "needs_auth"
    AUTHENTICATED = "authenticated"
    ERROR = "error"
    EXPIRED = "expired"  # noqa


@dataclass
class OAuthServerInfo:
    """OAuth information for an MCP server."""

    server_name: str
    mcp_url: str
    status: OAuthStatus
    scopes: list[str] | None = None
    client_name: str = "OpenEdison MCP Gateway"
    error_message: str | None = None
    token_expires_at: str | None = None
    has_refresh_token: bool = False


class OAuthManager:
    """
    Manages OAuth authentication for MCP servers.

    This class provides a centralized interface for:
    - Detecting which MCP servers require OAuth
    - Managing OAuth tokens and credentials
    - Providing OAuth authentication objects for FastMCP clients
    - Handling token refresh and expiration
    """

    def __init__(self, cache_dir: Path | None = None):
        """
        Initialize OAuth manager.

        Args:
            cache_dir: Directory for token cache. Defaults to FastMCP's default.
        """
        self.cache_dir = cache_dir or default_cache_dir()
        self._oauth_info: dict[str, OAuthServerInfo] = {}

        log.info(f"🔐 OAuth Manager initialized with cache dir: {self.cache_dir}")

    async def check_oauth_requirement(
        self, server_name: str, mcp_url: str | None, timeout_seconds: float = 10.0
    ) -> OAuthServerInfo:
        """
        Check if an MCP server requires OAuth authentication.

        Args:
            server_name: Name of the MCP server
            mcp_url: URL of the MCP endpoint (None for local servers)
            timeout_seconds: Timeout for the check request

        Returns:
            OAuthServerInfo with detection results
        """
        log.debug(f"🔍 Checking OAuth requirement for {server_name}")

        # If no mcp_url provided, this is a local server - no OAuth needed
        if not mcp_url:
            info = OAuthServerInfo(
                server_name=server_name, mcp_url="", status=OAuthStatus.NOT_REQUIRED
            )
            log.info(f"✅ {server_name} is a local server - no OAuth required")
            self._oauth_info[server_name] = info
            return info

        log.debug(f"🔍 Checking OAuth requirement for remote server {server_name} at {mcp_url}")

        try:
            # Check if auth is required (with timeout)
            auth_required = await asyncio.wait_for(
                check_if_auth_required(mcp_url), timeout=timeout_seconds
            )

            if not auth_required:
                info = OAuthServerInfo(
                    server_name=server_name, mcp_url=mcp_url, status=OAuthStatus.NOT_REQUIRED
                )
                log.info(f"✅ {server_name} does not require OAuth")
                self._oauth_info[server_name] = info
                return info

            # OAuth is required, proceed with token checking
            log.info(f"🔐 {server_name} requires OAuth authentication")

            # Check if we have existing valid tokens
            token_storage = FileTokenStorage(server_url=mcp_url, cache_dir=self.cache_dir)
            existing_tokens = await token_storage.get_tokens()

            status = OAuthStatus.NEEDS_AUTH
            token_expires_at = None
            has_refresh_token = False

            if existing_tokens:
                # Check if tokens are still valid
                # Note: FastMCP's FileTokenStorage doesn't expose expiration directly,
                # so we'll attempt to use the tokens and see if they work
                has_refresh_token = bool(existing_tokens.refresh_token)
                if existing_tokens.access_token:
                    # We have tokens, assume they're valid for now
                    # The actual validation will happen when the client tries to use them
                    status = OAuthStatus.AUTHENTICATED
                    # Try to get expiration time if available
                    try:
                        expires_at = getattr(existing_tokens, "expires_at", None)
                        if expires_at:
                            token_expires_at = str(expires_at)
                        else:
                            expires_in = getattr(existing_tokens, "expires_in", None)
                            if expires_in:
                                # If expires_in is available, we can calculate expiration

                                expiry = datetime.now() + timedelta(seconds=expires_in)
                                token_expires_at = expiry.isoformat()
                    except Exception:
                        # If we can't get expiration info, that's ok - token_expires_at will be None
                        pass

            info = OAuthServerInfo(
                server_name=server_name,
                mcp_url=mcp_url,
                status=status,
                scopes=None,  # We don't have metadata discovery, so no scopes info
                token_expires_at=token_expires_at,
                has_refresh_token=has_refresh_token,
            )

            log.info(f"🔐 {server_name} OAuth status: {status.value}")
            self._oauth_info[server_name] = info
            return info

        except TimeoutError:
            info = OAuthServerInfo(
                server_name=server_name,
                mcp_url=mcp_url,
                status=OAuthStatus.ERROR,
                error_message=f"OAuth check timed out after {timeout_seconds}s",
            )
            log.warning(f"⏰ OAuth check for {server_name} timed out")
            self._oauth_info[server_name] = info
            return info

        except Exception as e:
            info = OAuthServerInfo(
                server_name=server_name,
                mcp_url=mcp_url,
                status=OAuthStatus.ERROR,
                error_message=str(e),
            )
            log.error(f"❌ OAuth check for {server_name} failed: {e}")
            self._oauth_info[server_name] = info
            return info

    def get_oauth_auth(
        self,
        server_name: str,
        mcp_url: str,
        scopes: list[str] | None = None,
        client_name: str | None = None,
    ) -> OAuth | None:
        """
        Get OAuth authentication object for FastMCP client.

        Args:
            server_name: Name of the MCP server
            mcp_url: URL of the MCP endpoint
            scopes: OAuth scopes to request
            client_name: Client name for OAuth registration

        Returns:
            OAuth authentication object, or None if OAuth not required
        """
        info = self._oauth_info.get(server_name)

        if not info or info.status == OAuthStatus.NOT_REQUIRED:
            return None

        if info.status == OAuthStatus.ERROR:
            log.warning(f"⚠️ Cannot create OAuth auth for {server_name}: {info.error_message}")
            return None

        try:
            oauth = OpenEdisonOAuth(
                mcp_url=mcp_url,
                scopes=scopes or info.scopes,
                client_name=client_name or info.client_name,
                token_storage_cache_dir=self.cache_dir,
                callback_port=50001,
            )
            log.info(f"🔐 Created OAuth auth for {server_name}")
            return oauth

        except Exception as e:
            log.error(f"❌ Failed to create OAuth auth for {server_name}: {e}")
            return None

    def clear_tokens(self, server_name: str, mcp_url: str) -> bool:
        """
        Clear stored OAuth tokens for a server.

        Args:
            server_name: Name of the MCP server
            mcp_url: URL of the MCP endpoint

        Returns:
            True if tokens were cleared successfully
        """
        try:
            token_storage = FileTokenStorage(server_url=mcp_url, cache_dir=self.cache_dir)
            token_storage.clear()

            # Update our cached info
            if server_name in self._oauth_info:
                self._oauth_info[server_name].status = OAuthStatus.NEEDS_AUTH
                self._oauth_info[server_name].token_expires_at = None
                self._oauth_info[server_name].has_refresh_token = False

            log.info(f"🗑️ Cleared OAuth tokens for {server_name}")
            return True

        except Exception as e:
            log.error(f"❌ Failed to clear tokens for {server_name}: {e}")
            return False

    def get_server_info(self, server_name: str) -> OAuthServerInfo | None:
        """Get OAuth info for a server."""
        return self._oauth_info.get(server_name)

    async def refresh_server_status(self, server_name: str, mcp_url: str) -> OAuthServerInfo:
        """
        Refresh OAuth status for a server.

        Args:
            server_name: Name of the MCP server
            mcp_url: URL of the MCP endpoint

        Returns:
            Updated OAuthServerInfo
        """
        return await self.check_oauth_requirement(server_name, mcp_url)


# Global OAuth manager instance
_oauth_manager: OAuthManager | None = None


def get_oauth_manager() -> OAuthManager:
    """Get the global OAuth manager instance."""
    global _oauth_manager
    if _oauth_manager is None:
        _oauth_manager = OAuthManager()
    return _oauth_manager
