from __future__ import annotations

import os
import time

import pytest

from src.config import TelemetryConfig  # type: ignore[reportMissingImports]
from src import telemetry as tel  # type: ignore[reportMissingImports]


@pytest.mark.skipif(
    os.environ.get("EDISON_OTEL_E2E") != "1",
    reason="Set EDISON_OTEL_E2E=1 to run real OTLP export test",
)
def test_real_otlp_export() -> None:
    endpoint = os.environ.get("EDISON_OTEL_COLLECTOR_URL") or os.environ.get(
        "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"
    )

    # Reset module state
    tel._initialized = False  # type: ignore[attr-defined]
    tel._provider = None  # type: ignore[attr-defined]

    if endpoint:
        # Use provided endpoint
        tel.initialize_telemetry(
            override=TelemetryConfig(enabled=True, otlp_endpoint=endpoint, export_interval_ms=1000)
        )
    else:
        # Rely on hardcoded default in config
        tel.initialize_telemetry()
    assert tel._initialized is True  # type: ignore[attr-defined]

    # Emit a burst of metrics for visibility in Grafana
    for _ in range(100):
        tel.record_tool_call("e2e")
    tel.record_resource_used("e2e-resource")
    tel.set_servers_installed(1)

    # Give the periodic reader a moment and force flush
    time.sleep(2.0)
    _ = tel.force_flush_metrics(3000)

    # We cannot assert remote reception here without querying the backend.
    # Success criteria: no exceptions were raised and provider exists.
    assert tel._provider is not None  # type: ignore[attr-defined]
