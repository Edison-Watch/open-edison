from typing import Any, cast


def summarize_args(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    """Best-effort small, safe summary of arguments.

    Avoids large/binary payloads and PII leakage by only including types and small primitives.
    """
    parts: list[str] = []

    def _one(val: Any) -> str:
        if val is None:
            return "None"
        if isinstance(val, bool | int | float):
            return str(val)
        if isinstance(val, str):
            s = val.strip()
            return s if len(s) <= 64 else s[:61] + "..."
        the_type = cast(type[object], type(val))
        try:
            mod = getattr(the_type, "__module__", "builtins")
            name = getattr(the_type, "__name__", "object")
        except Exception:
            mod, name = "builtins", "object"
        return f"<{mod}.{name}>"

    if args:
        parts.append(
            "args=["
            + ", ".join(_one(a) for a in args[:5])
            + (" ..." if len(args) > 5 else "")
            + "]"
        )
    if kwargs:
        keys = list(kwargs.keys())[:8]
        krepr = ", ".join(f"{k}={_one(kwargs[k])}" for k in keys)
        suffix = " ..." if len(kwargs) > 8 else ""
        parts.append(f"kwargs=[{krepr}{suffix}]")
    return "; ".join(parts) if parts else ""
