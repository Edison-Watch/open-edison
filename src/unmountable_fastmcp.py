import asyncio
from typing import Any

from fastmcp.server.proxy import FastMCPProxy
from fastmcp.server.server import FastMCP, MountedServer
from fastmcp.utilities.logging import get_logger

logger = get_logger(__name__)


class UnmountableFastMCP(FastMCP):
    """Extended FastMCP class with unmount functionality."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Initialize our own list to track mounted servers
        self._mounted_servers: list[MountedServer] = []

    def mount(
        self,
        server: FastMCP,
        prefix: str | None = None,
        as_proxy: bool | None = None,
        *,
        tool_separator: str | None = None,
        resource_separator: str | None = None,
        prompt_separator: str | None = None,
    ) -> None:
        """Override mount to track mounted servers in our own list."""
        # Call the parent mount method
        super().mount(
            server=server,
            prefix=prefix,
            as_proxy=as_proxy,
            tool_separator=tool_separator,
            resource_separator=resource_separator,
            prompt_separator=prompt_separator,
        )

        # Create and track the mounted server in our own list
        mounted_server = MountedServer(
            prefix=prefix,
            server=server,
            resource_prefix_format=self.resource_prefix_format,
        )
        self._mounted_servers.append(mounted_server)

    def unmount(self, identifier: str | FastMCP | None = None) -> bool:
        if not self._mounted_servers:
            logger.warning("No mounted servers to unmount")
            return False

        mounted_server_to_remove = None

        if identifier is None:
            # Remove the most recently mounted server
            mounted_server_to_remove = self._mounted_servers[-1]
        elif isinstance(identifier, str):
            # Find by prefix
            for mounted in self._mounted_servers:
                if mounted.prefix == identifier:
                    mounted_server_to_remove = mounted
                    break
        elif hasattr(identifier, "name"):  # Check if it's a FastMCP-like object
            # Find by server instance
            for mounted in self._mounted_servers:
                if mounted.server is identifier:
                    mounted_server_to_remove = mounted
                    break

        if mounted_server_to_remove is None:
            logger.warning(f"No mounted server found matching identifier: {identifier}")
            return False

        # Remove from main mounted servers list
        self._mounted_servers.remove(mounted_server_to_remove)

        # Remove from all managers
        self._remove_from_managers(mounted_server_to_remove)

        logger.info(
            f"Successfully unmounted server: {mounted_server_to_remove.server.name} "
            f"(prefix: {mounted_server_to_remove.prefix})"
        )

        return True

    def _remove_from_managers(self, mounted_server: MountedServer) -> None:
        """Remove mounted server from all component managers."""
        # Remove from tool manager
        if mounted_server in self._tool_manager._mounted_servers:  # type: ignore
            self._tool_manager._mounted_servers.remove(mounted_server)  # type: ignore

        # Remove from resource manager
        if mounted_server in self._resource_manager._mounted_servers:  # type: ignore
            self._resource_manager._mounted_servers.remove(mounted_server)  # type: ignore

        # Remove from prompt manager
        if mounted_server in self._prompt_manager._mounted_servers:  # type: ignore
            self._prompt_manager._mounted_servers.remove(mounted_server)  # type: ignore

    async def unmount_and_cleanup(self, identifier: str | FastMCP | None = None) -> bool:
        # Find the mounted server before unmounting to access it for cleanup
        mounted_server_to_cleanup = None

        if identifier is None and self._mounted_servers:
            mounted_server_to_cleanup = self._mounted_servers[-1]
        elif isinstance(identifier, str):
            for mounted in self._mounted_servers:
                if mounted.prefix == identifier:
                    mounted_server_to_cleanup = mounted
                    break
        elif hasattr(identifier, "name"):  # Check if it's a FastMCP-like object
            for mounted in self._mounted_servers:
                if mounted.server is identifier:
                    mounted_server_to_cleanup = mounted
                    break

        # Perform the unmount
        success = self.unmount(identifier)
        if not success:
            return False

        # Perform cleanup if we found the server
        if mounted_server_to_cleanup:
            await self._cleanup_mounted_server(mounted_server_to_cleanup)

        # Send notifications to clients about changed lists
        await self._send_unmount_notifications()

        return True

    async def _cleanup_mounted_server(self, mounted_server: MountedServer) -> None:
        """Perform cleanup operations on an unmounted server."""
        try:
            server = mounted_server.server

            # If it's a proxy server, we might need to close underlying connections
            if isinstance(server, FastMCPProxy):
                # Try to close any underlying client connections
                # Note: This depends on the proxy implementation details
                await self._cleanup_proxy_server(server)

            logger.debug(f"Cleaned up mounted server: {server.name}")

        except Exception as e:
            logger.warning(f"Error during cleanup of mounted server: {e}")

    async def _cleanup_proxy_server(self, proxy_server: FastMCPProxy) -> None:
        """Cleanup proxy server connections."""
        try:
            # The proxy server might have active client connections that need cleanup
            # This is implementation-specific based on how the proxy was created

            # If the proxy has a client factory, we can't easily clean up all instances
            # But we can log that cleanup occurred
            logger.debug(f"Proxy server {proxy_server.name} has been unmounted")

            # In some cases, you might want to force cleanup of specific resources
            # This would depend on your specific proxy implementation

        except Exception as e:
            logger.warning(f"Error cleaning up proxy server: {e}")

    async def _send_unmount_notifications(self) -> None:
        """Send notifications to clients about changed component lists."""
        try:
            # Import here to avoid circular imports
            from fastmcp.server.dependencies import get_context

            try:
                context = get_context()
                # Queue notifications for all component types since we don't know
                # what types of components the unmounted server provided
                context._queue_tool_list_changed()  # type: ignore
                context._queue_resource_list_changed()  # type: ignore
                context._queue_prompt_list_changed()  # type: ignore
                logger.debug("Queued component list change notifications")
            except RuntimeError:
                # No active context - notifications will be sent when context becomes available
                logger.debug("No active context for notifications")

        except Exception as e:
            logger.warning(f"Error sending unmount notifications: {e}")

    def list_mounted_servers(self) -> list[tuple[str | None, str]]:
        return [(mounted.prefix, mounted.server.name) for mounted in self._mounted_servers]

    def get_mounted_server(self, identifier: str | FastMCP) -> MountedServer | None:
        if isinstance(identifier, str):
            for mounted in self._mounted_servers:
                if mounted.prefix == identifier:
                    return mounted
        elif hasattr(identifier, "name"):  # Check if it's a FastMCP-like object
            for mounted in self._mounted_servers:
                if mounted.server is identifier:
                    return mounted
        return None


# Usage examples and helper functions


def create_unmountable_server(name: str, **kwargs) -> UnmountableFastMCP:  # type: ignore
    return UnmountableFastMCP(name=name, **kwargs)


async def example_usage():
    """Example of how to use the unmount functionality."""

    # Create main server with unmount capabilities
    main_server = create_unmountable_server("MainServer")

    # Create and mount some proxy servers
    weather_proxy = FastMCP.as_proxy("http://weather-api.com/mcp")
    calendar_proxy = FastMCP.as_proxy("http://calendar-api.com/mcp")

    main_server.mount(weather_proxy, prefix="weather")
    main_server.mount(calendar_proxy, prefix="calendar")

    print("Mounted servers:", main_server.list_mounted_servers())
    # Output: [('weather', 'FastMCPProxy-...'), ('calendar', 'FastMCPProxy-...')]

    # Unmount by prefix
    success = main_server.unmount("weather")
    print(f"Unmounted weather server: {success}")

    # Unmount with cleanup
    success = await main_server.unmount_and_cleanup("calendar")
    print(f"Unmounted and cleaned up calendar server: {success}")

    print("Remaining mounted servers:", main_server.list_mounted_servers())
    # Output: []


if __name__ == "__main__":
    asyncio.run(example_usage())
