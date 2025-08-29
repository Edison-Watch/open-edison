from typing import Any

from loguru import logger as log

MCPServerConfigT = Any


class MergePolicy:
    SKIP = "skip"
    OVERWRITE = "overwrite"
    RENAME = "rename"


def merge_servers(
    existing: list[MCPServerConfigT],
    imported: list[MCPServerConfigT],
    policy: str,
) -> list[MCPServerConfigT]:
    name_to_index: dict[str, int] = {s.name: i for i, s in enumerate(existing)}
    result: list[MCPServerConfigT] = list(existing)

    for server in imported:
        server.enabled = True
        if server.name in name_to_index:
            if policy == MergePolicy.SKIP:
                log.info("Skipping duplicate server '{}' (policy=skip)", server.name)
                continue
            if policy == MergePolicy.OVERWRITE:
                idx = name_to_index[server.name]
                log.info("Overwriting server '{}' (policy=overwrite)", server.name)
                result[idx] = server
                continue
            if policy == MergePolicy.RENAME:
                suffix = "-imported"
                base_name = server.name
                counter = 1
                new_name = f"{base_name}{suffix}"
                while new_name in name_to_index:
                    counter += 1
                    new_name = f"{base_name}{suffix}-{counter}"
                server.name = new_name
                log.info(
                    "Renamed imported server from '{}' to '{}' (policy=rename)", base_name, new_name
                )
        name_to_index[server.name] = len(result)
        result.append(server)
    return result
