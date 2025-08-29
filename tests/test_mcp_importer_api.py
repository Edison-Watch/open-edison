from typing import Any

import pytest

from scripts.mcp_importer.api import CLIENT, detect_clients, export_edison_to, import_from
from tests.test_template import TestTemplate


class TestMcpImporterApi(TestTemplate):
    def test_detect_clients_no_exception(self) -> None:
        detected = detect_clients()
        assert isinstance(detected, set)
        # Members, if any, should be CLIENT enum values
        for c in detected:
            assert isinstance(c, CLIENT)

    def test_export_edison_to_all_clients_dry_run(self) -> None:
        for client in CLIENT:
            # Dry-run and allow creating missing files (but no writes occur)
            result = export_edison_to(
                client,
                dry_run=True,
                create_if_missing=True,
            )
            # Should not write in dry-run
            assert result.dry_run is True
            assert result.wrote_changes is False

    def test_import_from_detected_clients_no_exception(self) -> None:
        detected = detect_clients()
        if not detected:
            pytest.skip("No editor clients detected on this environment")
        for client in detected:
            servers: list[Any] = import_from(client)
            assert isinstance(servers, list)
