import os
from types import SimpleNamespace
from typing import Any

import pytest

from src import telemetry as tel  # type: ignore[reportMissingImports]
from src.config import TelemetryConfig  # type: ignore[reportMissingImports]


def _reset_telemetry_state() -> None:
    tel._initialized = False  # type: ignore[attr-defined]
    tel._install_id = None  # type: ignore[attr-defined]
    tel._tool_calls_counter = None  # type: ignore[attr-defined]
    tel._tool_calls_blocked_counter = None  # type: ignore[attr-defined]
    tel._servers_installed_gauge = None  # type: ignore[attr-defined]
    tel._resource_used_counter = None  # type: ignore[attr-defined]
    tel._prompt_used_counter = None  # type: ignore[attr-defined]
    tel._private_data_access_counter = None  # type: ignore[attr-defined]
    tel._untrusted_public_data_counter = None  # type: ignore[attr-defined]
    tel._write_operation_counter = None  # type: ignore[attr-defined]


def test_initialize_skips_without_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_telemetry_state()

    # Ensure env does not provide an endpoint
    for k in ("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT"):
        if k in os.environ:
            monkeypatch.delenv(k, raising=False)

    called = {"exporter": False}

    def _fake_exporter(**kwargs: Any) -> Any:  # noqa: ANN401
        called["exporter"] = True
        return SimpleNamespace()

    monkeypatch.setattr(tel.otlp_metric_exporter, "OTLPMetricExporter", _fake_exporter)

    tel.initialize_telemetry(override=TelemetryConfig(enabled=True, otlp_endpoint=None))

    assert tel._initialized is True  # type: ignore[attr-defined]
    # Exporter should not be constructed when no endpoint is configured
    assert called["exporter"] is False


def test_initialize_with_endpoint_sets_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_telemetry_state()

    seen: dict[str, Any] = {"exporter_kwargs": None, "reader_kwargs": None, "provider_set": False}

    def _fake_exporter(**kwargs: Any) -> Any:  # noqa: ANN401
        seen["exporter_kwargs"] = kwargs
        return SimpleNamespace()

    def _fake_reader(*, exporter: Any, export_interval_millis: int) -> Any:  # noqa: ANN401
        seen["reader_kwargs"] = {
            "exporter": exporter,
            "export_interval_millis": export_interval_millis,
        }
        return SimpleNamespace()

    def _fake_set_provider(provider: Any) -> None:  # noqa: ANN401
        seen["provider_set"] = True

    monkeypatch.setattr(tel.otlp_metric_exporter, "OTLPMetricExporter", _fake_exporter)
    monkeypatch.setattr(tel.ot_metrics_export, "PeriodicExportingMetricReader", _fake_reader)
    monkeypatch.setattr(tel.ot_metrics, "set_meter_provider", _fake_set_provider)

    # Avoid SDK internals by stubbing provider and meter
    def _fake_meter_provider(*args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        return SimpleNamespace()

    monkeypatch.setattr(tel.ot_sdk_metrics, "MeterProvider", _fake_meter_provider)

    class _FakeMeter:
        def create_counter(self, name: str) -> Any:  # noqa: ANN401
            return SimpleNamespace(add=lambda *a, **k: None)

        def create_up_down_counter(self, name: str) -> Any:
            return SimpleNamespace(add=lambda *a, **k: None)  #

    def _fake_get_meter(name: str) -> Any:  # noqa: ANN401
        return _FakeMeter()

    monkeypatch.setattr(tel.ot_metrics, "get_meter", _fake_get_meter)

    endpoint = "http://127.0.0.1:4318/v1/metrics"
    tel.initialize_telemetry(
        override=TelemetryConfig(enabled=True, otlp_endpoint=endpoint, export_interval_ms=1234)
    )

    assert tel._initialized is True  # type: ignore[attr-defined]
    assert seen["exporter_kwargs"] == {"endpoint": endpoint}
    assert isinstance(seen["reader_kwargs"], dict)
    assert seen["reader_kwargs"]["export_interval_millis"] == 1234
    assert seen["provider_set"] is True


def test_recorders_are_safe_noops_when_disabled() -> None:
    _reset_telemetry_state()

    # Disabled should short-circuit decorator path and not raise
    tel.initialize_telemetry(override=TelemetryConfig(enabled=False))

    tel.record_tool_call("x")
    tel.record_tool_call_blocked("x", "y")
    tel.set_servers_installed(1)
    tel.record_resource_used("res")
    tel.record_prompt_used("p")
    tel.record_private_data_access("src", "name")
    tel.record_untrusted_public_data("src", "name")
    tel.record_write_operation("src", "name")

    assert tel._initialized is True  # type: ignore[attr-defined]


def test_install_id_persists(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN401
    _reset_telemetry_state()

    # Redirect config dir to a temp location on telemetry module import binding
    monkeypatch.setattr(tel, "get_config_dir", lambda: tmp_path)

    # First call creates and writes ID
    id1 = tel._ensure_install_id()  # type: ignore[attr-defined]
    # Second call should read the same ID
    id2 = tel._ensure_install_id()  # type: ignore[attr-defined]

    assert id1 == id2
    id_file = tmp_path / "install_id"
    if id_file.exists():
        assert id_file.read_text(encoding="utf-8").strip() == id1
