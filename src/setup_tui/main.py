import argparse
import asyncio
import contextlib
import sys
from collections.abc import Generator

import questionary
from loguru import logger as log

import src.oauth_manager as oauth_mod
from src.config import MCPServerConfig, get_config_dir
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
from src.mcp_importer.parsers import deduplicate_by_name
from src.oauth_manager import OAuthStatus, get_oauth_manager


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


def handle_mcp_source(  # noqa: C901
    source: CLIENT, *, dry_run: bool = False, skip_oauth: bool = False
) -> list[MCPServerConfig]:
    """Handle the MCP source."""
    if not questionary.confirm(
        f"We have found {source.name} installed. Would you like to import its MCP servers to open-edison?",
        default=True,
    ).ask():
        return []

    configs = import_from(source)

    # Filter out any "open-edison" configs
    if "open-edison" in [config.name for config in configs]:
        print(
            "Found an 'open-edison' config. This is not allowed, so it will be excluded from the import."
        )

    configs = [config for config in configs if config.name != "open-edison"]

    print(f"Loaded {len(configs)} MCP server configuration from {source.name}!")

    verified_configs: list[MCPServerConfig] = []

    for config in configs:
        print(f"Verifying the configuration for {config.name}... ")
        result = verify_mcp_server(config)
        if result:
            # For remote servers, only prompt if OAuth is actually required
            if config.is_remote_server():
                # Heuristic: if inline headers are present (e.g., API key), treat as not requiring OAuth
                has_inline_headers: bool = any(
                    (a == "--header" or a.startswith("--header")) for a in config.args
                )
                if not has_inline_headers:
                    # Prefer cached result from verification; only check if missing
                    oauth_mgr = get_oauth_manager()
                    info = oauth_mgr.get_server_info(config.name)
                    if info is None:
                        info = asyncio.run(
                            oauth_mgr.check_oauth_requirement(config.name, config.get_remote_url())
                        )

                    if info.status == OAuthStatus.NEEDS_AUTH:
                        tokens_present: bool = has_oauth_tokens(config)
                        if not tokens_present:
                            if skip_oauth:
                                print(
                                    f"Skipping OAuth for {config.name} due to --skip-oauth (OAuth required, no tokens). This server will not be imported."
                                )
                                continue

                            if questionary.confirm(
                                f"{config.name} requires OAuth and no credentials were found. Obtain credentials now?",
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

            print(f"Verification successful for {config.name}.")
            verified_configs.append(config)
        else:
            print(
                f"Verification failed for the configuration of {config.name}. Please check the configuration and try again."
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
        f"Would you like to set up Open Edison for {client.name}? (This will modify your MCP configuration. We will make a back up of your current one if you would like to revert.)",
        default=True,
    ).ask():
        return

    result = export_edison_to(client, dry_run=dry_run)
    if dry_run:
        print(f"[dry-run] Export prepared for {client.name}; no changes written.")
    else:
        print(
            f"Successfully set up Open Edison for {client.name}! Your previous MCP configuration has been backed up at {result.backup_path}"
        )


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

    json_snippet = """\t{
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


class _TuiLogger:
    def _fmt(self, msg: object, *args: object) -> str:
        try:
            if isinstance(msg, str) and args:
                return msg.format(*args)
        except Exception:
            pass
        return str(msg)

    def info(self, msg: object, *args: object, **kwargs: object) -> None:
        questionary.print(self._fmt(msg, *args), style="fg:ansiblue")

    def debug(self, msg: object, *args: object, **kwargs: object) -> None:
        questionary.print(self._fmt(msg, *args), style="fg:ansiblack")

    def warning(self, msg: object, *args: object, **kwargs: object) -> None:
        questionary.print(self._fmt(msg, *args), style="bold fg:ansiyellow")

    def error(self, msg: object, *args: object, **kwargs: object) -> None:
        questionary.print(self._fmt(msg, *args), style="bold fg:ansired")


@contextlib.contextmanager
def suppress_loguru_output() -> Generator[None, None, None]:
    """Suppress loguru output."""
    with contextlib.suppress(Exception):
        log.remove()

    old_logger = oauth_mod.log
    # Route oauth_manager's log calls to questionary for TUI output
    oauth_mod.log = _TuiLogger()  # type: ignore[attr-defined]
    yield
    oauth_mod.log = old_logger
    log.add(sys.stdout, level="INFO")


@suppress_loguru_output()
def run(*, dry_run: bool = False, skip_oauth: bool = False) -> bool:  # noqa: C901
    """Run the complete setup process.
    Returns whether the setup was successful."""
    show_welcome_screen(dry_run=dry_run)
    # Additional setup steps will be added here

    mcp_clients = sorted(detect_clients(), key=lambda x: x.value)

    configs: list[MCPServerConfig] = []

    for client in mcp_clients:
        configs.extend(handle_mcp_source(client, dry_run=dry_run, skip_oauth=skip_oauth))

    if len(configs) == 0:
        if not questionary.confirm(
            "No MCP servers found. Would you like to continue without them?", default=True
        ).ask():
            print("Setup aborted. Please configure an MCP client and try again.")
            return False
        return True

    # Deduplicate configs
    configs = deduplicate_by_name(configs)

    if not confirm_configs(configs, dry_run=dry_run):
        return False

    for client in mcp_clients:
        confirm_apply_configs(client, dry_run=dry_run)

    # Persist imported servers into config.json
    if len(configs) > 0:
        save_imported_servers(configs, dry_run=dry_run)

    show_manual_setup_screen()

    return True


# Triggered from cli.py
def run_import_tui(args: argparse.Namespace, force: bool = False) -> bool:
    """Run the import TUI, if necessary."""
    # Find config dir, check if ".setup_tui_ran" exists
    config_dir = get_config_dir()
    config_dir.mkdir(parents=True, exist_ok=True)

    setup_tui_ran_file = config_dir / ".setup_tui_ran"
    success = True
    if not setup_tui_ran_file.exists() or force:
        success = run(dry_run=args.wizard_dry_run, skip_oauth=args.wizard_skip_oauth)

    setup_tui_ran_file.touch()

    return success


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
