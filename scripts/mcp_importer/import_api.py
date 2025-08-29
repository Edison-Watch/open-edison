from collections.abc import Iterable

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

from src.config import Config, get_config_dir, get_config_json_path

from .importers import IMPORTERS
from .merge import MergePolicy, merge_servers


@dataclass
class ImportPreview:
    target_dir: Path
    source: str
    merge_policy: str
    existing_names: list[str]
    imported_names: list[str]
    added: list[str]
    replaced: list[str]
    total_after_merge: int
    merged_serialized: list[dict[str, Any]]


def _serialize_servers(servers: Iterable[Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for s in servers:
        try:
            results.append(asdict(s))
        except Exception:
            results.append(
                {
                    "name": getattr(s, "name", ""),
                    "command": getattr(s, "command", ""),
                    "args": list(getattr(s, "args", [])),
                    "env": dict(getattr(s, "env", {})),
                    "enabled": bool(getattr(s, "enabled", False)),
                    "roots": getattr(s, "roots", None),
                    "oauth_scopes": getattr(s, "oauth_scopes", None),
                    "oauth_client_name": getattr(s, "oauth_client_name", None),
                }
            )
    return results


def preview_import(
    *,
    source: str,
    config_dir: Path | None = None,
    merge_policy: str = MergePolicy.SKIP,
) -> ImportPreview:
    """Preview importing MCP servers without writing changes.

    Returns a structured summary including the fully merged serialized config snippet.
    """
    importer = IMPORTERS.get(source)
    if importer is None:
        raise ValueError(f"Unsupported source: {source}")

    # Resolve target config directory
    target_dir: Path = Path(config_dir) if config_dir is not None else get_config_dir()
    # Load config (auto-creates default if missing via Config)
    cfg: Any = Config(target_dir)

    # Load imported servers
    imported_servers = importer()  # type: ignore[misc]

    merged = merge_servers(
        existing=cfg.mcp_servers,
        imported=imported_servers,
        policy=merge_policy,
    )

    existing_names = [str(getattr(s, "name", "")) for s in cast(Iterable[Any], cfg.mcp_servers)]
    imported_names = [str(getattr(s, "name", "")) for s in imported_servers]
    added = sorted({str(getattr(s, "name", "")) for s in merged} - set(existing_names))
    replaced: list[str] = []
    if merge_policy == MergePolicy.OVERWRITE:
        replaced = sorted(set(existing_names) & set(imported_names))

    merged_serialized = _serialize_servers(merged)

    return ImportPreview(
        target_dir=target_dir,
        source=source,
        merge_policy=merge_policy,
        existing_names=sorted(existing_names),
        imported_names=sorted(imported_names),
        added=added,
        replaced=replaced,
        total_after_merge=len(merged_serialized),
        merged_serialized=merged_serialized,
    )


def apply_import(
    *,
    source: str,
    config_dir: Path | None = None,
    merge_policy: str = MergePolicy.SKIP,
) -> Path:
    """Apply an import by writing the merged config back to disk.

    Returns the path to the written config.json.
    """
    target_dir: Path = Path(config_dir) if config_dir is not None else get_config_dir()
    cfg: Any = Config(target_dir)
    importer = IMPORTERS.get(source)
    if importer is None:
        raise ValueError(f"Unsupported source: {source}")

    imported_servers = importer()  # type: ignore[misc]

    merged = merge_servers(
        existing=cfg.mcp_servers,
        imported=imported_servers,
        policy=merge_policy,
    )

    cfg.mcp_servers = merged
    cfg.save(target_dir)

    # Resolve and return path
    return get_config_json_path() if config_dir is None else Path(config_dir) / "config.json"
