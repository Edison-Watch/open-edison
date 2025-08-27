"""
Telemetry for Open Edison (opt-out).
This module provides a thin, optional wrapper around OpenTelemetry to export
basic usage metrics to an OTLP endpoint. If telemetry is disabled or the
OpenTelemetry packages are not installed, all functions are safe no-ops.

Events/metrics captured (high level, install-unique ID for deaggregation):
- tool_calls_total (counter)
- tool_calls_blocked_total (counter)
- servers_installed_total (up-down counter / gauge)
- tool_calls_metadata_total (counter)
- resource_used_total (counter)
- prompt_used_total (counter)
- private_data_access_calls_total (counter)
- untrusted_public_data_calls_total (counter)
- write_operation_calls_total (counter)

Configuration: see `TelemetryConfig` in `src.config`.
"""

import os
import platform
import traceback
import uuid
from collections.abc import Callable
from typing import Any, ParamSpec, TypeVar

from loguru import logger as log

# OpenTelemetry metrics components
from opentelemetry import metrics as ot_metrics
from opentelemetry.exporter.otlp.proto.http import metric_exporter as otlp_metric_exporter
from opentelemetry.sdk import metrics as ot_sdk_metrics
from opentelemetry.sdk.metrics import export as ot_metrics_export
from opentelemetry.sdk.resources import Resource  # type: ignore[reportMissingTypeStubs]

from src.config import Config, TelemetryConfig, get_config_dir

_initialized: bool = False
_install_id: str | None = None
_provider: Any | None = None
_tool_calls_counter: Any | None = None
_tool_calls_blocked_counter: Any | None = None
_servers_installed_gauge: Any | None = None
_tool_calls_metadata_counter: Any | None = None
_resource_used_counter: Any | None = None
_prompt_used_counter: Any | None = None
_private_data_access_counter: Any | None = None
_untrusted_public_data_counter: Any | None = None
_write_operation_counter: Any | None = None
_resource_access_blocked_counter: Any | None = None
_prompt_access_blocked_counter: Any | None = None


def _ensure_install_id() -> str:
    """Create or read a persistent install-unique ID under the config dir."""
    global _install_id
    if _install_id:
        return _install_id
    try:
        cfg_dir = get_config_dir()
        cfg_dir.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001
        log.error(
            "Could not resolve or create config dir for install_id; using ephemeral ID\n{}",
            traceback.format_exc(),
        )
        _install_id = str(uuid.uuid4())
        return _install_id

    id_file = cfg_dir / "install_id"
    if id_file.exists():
        try:
            _install_id = id_file.read_text(encoding="utf-8").strip() or str(uuid.uuid4())
        except Exception:  # noqa: BLE001
            log.error(
                "Failed reading install_id file; using ephemeral ID\n{}",
                traceback.format_exc(),
            )
            _install_id = str(uuid.uuid4())
    else:
        _install_id = str(uuid.uuid4())
        try:
            id_file.write_text(_install_id, encoding="utf-8")
        except Exception:  # noqa: BLE001
            log.error(
                "Failed writing install_id file; continuing without persistence\n{}",
                traceback.format_exc(),
            )
    return _install_id


def _telemetry_enabled() -> bool:
    tel_cfg = Config().telemetry or TelemetryConfig()
    return bool(tel_cfg.enabled)


P = ParamSpec("P")
R = TypeVar("R")


def telemetry_recorder(func: Callable[P, R]) -> Callable[P, R | None]:  # noqa: UP047
    """No-op when disabled, ensure init, and catch/log failures."""

    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R | None:  # type: ignore[override]
        if not _telemetry_enabled():
            return None
        if not _initialized:
            initialize_telemetry()
        try:
            return func(*args, **kwargs)
        except Exception:  # noqa: BLE001
            log.error("Telemetry emit failed\n{}", traceback.format_exc())
            return None

    return wrapper


def initialize_telemetry(override: TelemetryConfig | None = None) -> None:  # noqa: C901
    """Initialize telemetry if enabled in config.

    Safe to call multiple times; only first call initializes.
    """
    global \
        _initialized, \
        _provider, \
        _tool_calls_counter, \
        _tool_calls_blocked_counter, \
        _servers_installed_gauge

    if _initialized:
        return

    telemetry_cfg = override if override is not None else (Config().telemetry or TelemetryConfig())
    if not telemetry_cfg.enabled:
        log.debug("Telemetry disabled by config")
        _initialized = True
        return

    # Exporter
    exporter_kwargs: dict[str, Any] = {}
    if telemetry_cfg.otlp_endpoint:
        exporter_kwargs["endpoint"] = telemetry_cfg.otlp_endpoint
    # Allow environment variables to provide endpoint when not set in config
    env_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") or os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    if "endpoint" not in exporter_kwargs and env_endpoint:
        exporter_kwargs["endpoint"] = env_endpoint
    # If no endpoint is available from config or env, skip initialization quietly
    if "endpoint" not in exporter_kwargs:
        log.debug("No OTLP endpoint configured (config or env); skipping telemetry init")
        _initialized = True
        return
    if telemetry_cfg.headers:
        exporter_kwargs["headers"] = telemetry_cfg.headers

    try:
        exporter: Any = otlp_metric_exporter.OTLPMetricExporter(**exporter_kwargs)
    except Exception:  # noqa: BLE001
        log.error("OTLP exporter init failed\n{}", traceback.format_exc())
        return

    # Reader
    try:
        reader: Any = ot_metrics_export.PeriodicExportingMetricReader(
            exporter=exporter,
            export_interval_millis=max(1000, telemetry_cfg.export_interval_ms),
        )
    except Exception:  # noqa: BLE001
        log.error("OTLP reader init failed\n{}", traceback.format_exc())
        return

    # Provider/meter
    try:
        # Capture platform/runtime details
        install_id = _ensure_install_id()
        os_type = platform.system().lower() or "unknown"
        os_description = platform.platform()
        host_arch = platform.machine()
        runtime_version = platform.python_version()
        service_version = Config().version

        # Attach a resource so metrics include service identifiers
        resource = Resource.create(
            {
                "service.name": "open-edison",
                "service.namespace": "open-edison",
                "service.version": service_version,
                "service.instance.id": install_id,
                "telemetry.sdk.language": "python",
                "os.type": os_type,
                "os.description": os_description,
                "host.arch": host_arch,
                "process.runtime.name": "python",
                "process.runtime.version": runtime_version,
            }
        )
        provider: Any = ot_sdk_metrics.MeterProvider(metric_readers=[reader], resource=resource)
        _provider = provider
        ot_metrics.set_meter_provider(provider)
        meter: Any = ot_metrics.get_meter("open-edison")
    except Exception:  # noqa: BLE001
        log.error("Metrics provider init failed\n{}", traceback.format_exc())
        return

    # Instruments
    try:
        # Do not suffix counters with _total; Prometheus exporter appends it
        _tool_calls_counter = meter.create_counter("tool_calls")
        _tool_calls_blocked_counter = meter.create_counter("tool_calls_blocked")
        _servers_installed_gauge = meter.create_up_down_counter("servers_installed")
        _tool_calls_metadata_counter = meter.create_counter("tool_calls_metadata")
        _resource_used_counter = meter.create_counter("resource_used")
        _resource_access_blocked_counter = meter.create_counter("resource_access_blocked")
        _prompt_used_counter = meter.create_counter("prompt_used")
        _prompt_access_blocked_counter = meter.create_counter("prompt_access_blocked")
        _private_data_access_counter = meter.create_counter("private_data_access_calls")
        _untrusted_public_data_counter = meter.create_counter("untrusted_public_data_calls")
        _write_operation_counter = meter.create_counter("write_operation_calls")
    except Exception:  # noqa: BLE001
        log.error("Metrics instrument creation failed\n{}", traceback.format_exc())
        return

    _ = install_id
    _initialized = True
    log.info("📈 Telemetry initialized")


def _common_attrs(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    attrs: dict[str, Any] = {"install_id": _ensure_install_id(), "app": "open-edison"}
    if extra:
        attrs.update(extra)
    return attrs


@telemetry_recorder
def record_tool_call(tool_name: str) -> None:
    if _tool_calls_counter is None:
        return
    _tool_calls_counter.add(1, attributes=_common_attrs({"tool": tool_name}))


@telemetry_recorder
def record_tool_call_blocked(tool_name: str, reason: str) -> None:
    if _tool_calls_blocked_counter is None:
        return
    _tool_calls_blocked_counter.add(
        1, attributes=_common_attrs({"tool": tool_name, "reason": reason})
    )


@telemetry_recorder
def set_servers_installed(count: int) -> None:
    if _servers_installed_gauge is None:
        return
    _servers_installed_gauge.add(count, attributes=_common_attrs({"state": "snapshot"}))


@telemetry_recorder
def record_resource_used(resource_name: str) -> None:
    if _resource_used_counter is None:
        return
    _resource_used_counter.add(1, attributes=_common_attrs({"resource": resource_name}))


@telemetry_recorder
def record_resource_access_blocked(resource_name: str, reason: str) -> None:
    if _resource_access_blocked_counter is None:
        return
    _resource_access_blocked_counter.add(
        1, attributes=_common_attrs({"resource": resource_name, "reason": reason})
    )


@telemetry_recorder
def record_prompt_used(prompt_name: str) -> None:
    if _prompt_used_counter is None:
        return
    _prompt_used_counter.add(1, attributes=_common_attrs({"prompt": prompt_name}))


@telemetry_recorder
def record_prompt_access_blocked(prompt_name: str, reason: str) -> None:
    if _prompt_access_blocked_counter is None:
        return
    _prompt_access_blocked_counter.add(
        1, attributes=_common_attrs({"prompt": prompt_name, "reason": reason})
    )


@telemetry_recorder
def record_private_data_access(source_type: str, name: str) -> None:
    if _private_data_access_counter is None:
        return
    _private_data_access_counter.add(
        1, attributes=_common_attrs({"source_type": source_type, "name": name})
    )


@telemetry_recorder
def record_untrusted_public_data(source_type: str, name: str) -> None:
    if _untrusted_public_data_counter is None:
        return
    _untrusted_public_data_counter.add(
        1, attributes=_common_attrs({"source_type": source_type, "name": name})
    )


@telemetry_recorder
def record_write_operation(source_type: str, name: str) -> None:
    if _write_operation_counter is None:
        return
    _write_operation_counter.add(
        1, attributes=_common_attrs({"source_type": source_type, "name": name})
    )
