import argparse

import questionary

from src.config import MCPServerConfig
from src.mcp_importer.api import (
    CLIENT,
    authorize_server_oauth,
    detect_clients,
    export_edison_to,
    has_oauth_tokens,
    import_from,
    save_imported_servers,
    verify_mcp_server,
)


def show_welcome_screen(*, dry_run: bool = False) -> None:
    """Display the welcome screen for open-edison setup."""
    welcome_text = """
    ╔══════════════════════════════════════════════════════════════╗
    ║                                                              ║
    ║                    Welcome to open-edison                    ║
    ║                                                              ║
    ║     This setup wizard will help you configure open-edison    ║
    ║     for your development environment.                        ║
    ║                                                              ║
    ╚══════════════════════════════════════════════════════════════╝
    """

    print(welcome_text)

    # Prompt to continue
    questionary.confirm("Ready to begin the setup process?", default=True).ask()


def handle_mcp_source(
    source: CLIENT, *, dry_run: bool = False, skip_oauth: bool = False
) -> list[MCPServerConfig]:
    """Handle the MCP source."""
    if not questionary.confirm(
        f"We have found {source.name} installed. Would you like to import its MCP servers to open-edison?",
        default=True,
    ).ask():
        return []

    configs = import_from(source)

    print(f"Loaded {len(configs)} MCP server configuration from {source.name}!")

    verified_configs: list[MCPServerConfig] = []

    for config in configs:
        print(f"Verifying the configuration for {config.name}... ")
        result = verify_mcp_server(config)
        if result:
            # If this is a remote server, check OAuth status and optionally authorize
            if config.is_remote_server():
                # Always check token presence; if absent, prompt for OAuth unless skipped
                tokens_present: bool = has_oauth_tokens(config)
                if not tokens_present:
                    if skip_oauth:
                        print(
                            f"Skipping OAuth for {config.name} due to --skip-oauth (no tokens present). This server will not be imported."
                        )
                        continue

                    if questionary.confirm(
                        f"{config.name} is a remote server and no OAuth credentials were found. Obtain credentials now?",
                        default=True,
                    ).ask():
                        success = authorize_server_oauth(config)
                        if not success:
                            print(
                                f"Failed to obtain OAuth credentials for {config.name}. Skipping this server."
                            )
                            continue
                    else:
                        print(f"Skipping {config.name} per user choice.")
                        continue

            verified_configs.append(config)
        else:
            print(
                f"The configuration for {config.name} is not valid. Please check the configuration and try again."
            )

    return verified_configs


def confirm_configs(configs: list[MCPServerConfig], *, dry_run: bool = False) -> bool:
    """Confirm the MCP configs."""
    print("These are the servers you have selected:")

    for config in configs:
        print(f"○ {config.name}")

    return questionary.confirm(
        "Are you sure you want to use these servers with open-edison?", default=True
    ).ask()


def confirm_apply_configs(client: CLIENT, *, dry_run: bool = False) -> None:
    if not questionary.confirm(
        f"We have detected that you have {client.name} installed. Would you like to connect it to open-edison?",
        default=True,
    ).ask():
        return

    export_edison_to(client, dry_run=dry_run)
    if dry_run:
        print(f"[dry-run] Export prepared for {client.name}; no changes written.")
    else:
        print(f"Successfully set up Open Edison for {client.name}!")


def show_manual_setup_screen() -> None:
    """Display manual setup instructions for open-edison."""
    manual_setup_text = """
    ╔══════════════════════════════════════════════════════════════╗
    ║                                                              ║
    ║                     Manual Setup Instructions                ║
    ║                                                              ║
    ╚══════════════════════════════════════════════════════════════╝

    To set up open-edison manually in other clients, find your client's MCP config
    JSON file and add the following configuration:
    """

    json_snippet = """{
      "mcpServers": {
        "open-edison": {
          "command": "npx",
          "args": [
            "-y",
            "mcp-remote",
            "http://localhost:3000/mcp/",
            "--http-only",
            "--header",
            "Authorization: Bearer dev-api-key-change-me"
          ]
        }
      }
    }"""

    after_text = """
    Make sure to replace 'dev-api-key-change-me' with your actual API key.
    """

    print(manual_setup_text)
    # Use questionary's print with style for color
    questionary.print(json_snippet, style="bold fg:ansigreen")
    print(after_text)


def run(*, dry_run: bool = False, skip_oauth: bool = False) -> None:
    """Run the complete setup process."""
    show_welcome_screen(dry_run=dry_run)
    # Additional setup steps will be added here

    mcp_sources = detect_clients()
    mcp_clients = detect_clients()

    configs: list[MCPServerConfig] = []

    for source in mcp_sources:
        configs.extend(handle_mcp_source(source, dry_run=dry_run, skip_oauth=skip_oauth))

    if len(configs) == 0:
        print(
            "No MCP servers found. Please set up an MCP client with some servers and run this setup again."
        )
        return

    if not confirm_configs(configs, dry_run=dry_run):
        return

    for client in mcp_clients:
        confirm_apply_configs(client, dry_run=dry_run)

    # Persist imported servers into config.json
    if len(configs) > 0:
        save_imported_servers(configs, dry_run=dry_run)

    show_manual_setup_screen()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open Edison Setup TUI")
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without writing")
    parser.add_argument(
        "--skip-oauth",
        action="store_true",
        help="Skip OAuth for remote servers (they will be omitted from import)",
    )
    args = parser.parse_args(argv)

    run(dry_run=args.dry_run, skip_oauth=args.skip_oauth)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
