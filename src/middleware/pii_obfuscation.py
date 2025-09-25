from typing import Any, cast

import mcp.types as mt
from fastmcp.server.middleware import Middleware
from fastmcp.server.middleware.middleware import CallNext, MiddlewareContext
from fastmcp.tools.tool import ToolResult
from mcp.types import CallToolResult, TextContent

from src.middleware.session_tracking import current_session_id_ctxvar
from src.pii.db import store_token_db
from src.pii.detect import Finding, detect
from src.pii.presidio_wrap import analyze_with_presidio
from src.pii.tokens import TOKEN_PREFIX, detokenize_text, generate_token


def _obfuscate_text_dict(
    value: dict[str, Any], *, session_id: str, hex_bytes: int
) -> dict[str, Any]:
    type_field = value.get("type")
    if type_field == "text":
        text_field = value.get("text")
        if isinstance(text_field, str):
            updated = dict(value)
            updated["text"] = _obfuscate_text(
                text_field, session_id=session_id, hex_bytes=hex_bytes
            )
            return updated
    return value


def _obfuscate_text_content(value: TextContent, *, session_id: str, hex_bytes: int) -> TextContent:
    if value.type == "text":
        value.text = _obfuscate_text(value.text, session_id=session_id, hex_bytes=hex_bytes)  # type: ignore[attr-defined]
    return value


def _obfuscate_call_tool_result(
    result: CallToolResult, *, session_id: str, hex_bytes: int
) -> CallToolResult:
    # Obfuscate data
    if isinstance(result.data, str):  # type: ignore[attr-defined]
        result.data = _obfuscate_text(result.data, session_id=session_id, hex_bytes=hex_bytes)  # type: ignore[attr-defined]

    # Obfuscate structured_content.result
    sc_any = result.structured_content  # type: ignore[attr-defined]
    if isinstance(sc_any, dict):
        sc_dict = cast(dict[str, Any], sc_any).copy()
        res_val = sc_dict.get("result")
        if isinstance(res_val, str):
            sc_dict["result"] = _obfuscate_text(res_val, session_id=session_id, hex_bytes=hex_bytes)
            result.structured_content = sc_dict  # type: ignore[attr-defined]

    # Obfuscate text entries in content
    contents: list[Any] = result.content  # type: ignore[attr-defined]
    changed = False
    new_items: list[Any] = []
    for item in contents:
        if isinstance(item, TextContent) and item.type == "text":
            new_text = _obfuscate_text(item.text, session_id=session_id, hex_bytes=hex_bytes)  # type: ignore[attr-defined]
            if new_text != item.text:  # type: ignore[attr-defined]
                item.text = new_text  # type: ignore[attr-defined]
                changed = True
            new_items.append(item)
        else:
            new_items.append(item)
    if changed:
        result.content = new_items  # type: ignore[attr-defined]

    return result


def _obfuscate_flat_payload(  # noqa: C901 - union dispatcher kept local for clarity
    value: str | dict[str, Any] | CallToolResult | TextContent | ToolResult,
    *,
    session_id: str,
    hex_bytes: int,
) -> str | dict[str, Any] | CallToolResult | TextContent | ToolResult:
    """Obfuscate only top-level str, TextContent, CallToolResult, and ToolResult payloads.

    - Strings: fully obfuscated
    - Dicts: only {"type": "text", "text": ...} are supported
    - TextContent: text field obfuscated when type=="text"
    - CallToolResult/ToolResult: obfuscate .data, structured_content["result"], and any TextContent in .content
    """
    if isinstance(value, str):
        return _obfuscate_text(value, session_id=session_id, hex_bytes=hex_bytes)

    if isinstance(value, dict):
        return _obfuscate_text_dict(value, session_id=session_id, hex_bytes=hex_bytes)

    if isinstance(value, TextContent):
        return _obfuscate_text_content(value, session_id=session_id, hex_bytes=hex_bytes)

    if isinstance(value, ToolResult):
        # data
        if isinstance(getattr(value, "data", None), str):
            value.data = _obfuscate_text(  # type: ignore[attr-defined]
                getattr(value, "data", None),  # type: ignore[attr-defined]
                session_id=session_id,
                hex_bytes=hex_bytes,
            )  # type: ignore[attr-defined]
        # structured_content['result']
        if isinstance(getattr(value, "structured_content", None), dict):
            sc_copy = cast(dict[str, Any], getattr(value, "structured_content", None)).copy()
            rv = sc_copy.get("result")
            if isinstance(rv, str):
                sc_copy["result"] = _obfuscate_text(rv, session_id=session_id, hex_bytes=hex_bytes)
                value.structured_content = sc_copy  # type: ignore[attr-defined]
        # content list of TextContent
        if isinstance(getattr(value, "content", None), list):
            changed = False
            new_items: list[Any] = []
            for item in getattr(value, "content", None) or []:  # type: ignore[attr-defined]
                if isinstance(item, TextContent) and item.type == "text":
                    new_text = _obfuscate_text(
                        item.text, session_id=session_id, hex_bytes=hex_bytes
                    )  # type: ignore[attr-defined]
                    if new_text != item.text:  # type: ignore[attr-defined]
                        item.text = new_text  # type: ignore[attr-defined]
                        changed = True
                    new_items.append(item)
                else:
                    new_items.append(item)
            if changed:
                value.content = new_items  # type: ignore[attr-defined]
        return value

    # Remaining union case: CallToolResult
    return _obfuscate_call_tool_result(value, session_id=session_id, hex_bytes=hex_bytes)  # type: ignore[arg-type]


def _obfuscate_text(text: str, *, session_id: str, hex_bytes: int) -> str:
    def replace_findings(input_text: str, findings: list[Finding]) -> tuple[str, bool]:
        out: list[str] = []
        cursor = 0
        changed_local = False
        findings_sorted = sorted(findings, key=lambda f: f.start)
        for f in findings_sorted:
            if f.start < cursor:
                continue
            if input_text[f.start : f.start + len(TOKEN_PREFIX)].startswith(TOKEN_PREFIX):
                continue
            out.append(input_text[cursor : f.start])
            token = generate_token(hex_bytes)
            store_token_db(
                token=token,
                session_id=session_id,
                value_plaintext=f.value,
                categories=[f.category],
                source_kind="tool",
                source_name="",  # TODO, get source names from the Finding objects
            )
            out.append(token)
            cursor = f.end
            changed_local = True
        out.append(input_text[cursor:])
        return ("".join(out), changed_local)

    # Pass 1: regex-based obfuscation
    updated_text, _ = replace_findings(text, list(detect(text)))

    # Pass 2: Presidio-based obfuscation on the already-updated text
    updated_text, _ = replace_findings(updated_text, analyze_with_presidio(updated_text))

    return updated_text


class PIIObfuscationMiddleware(Middleware):
    async def on_call_tool(  # noqa: B018 - dynamically invoked by FastMCP middleware system
        self,
        context: MiddlewareContext[mt.CallToolRequestParams],  # type: ignore
        call_next: CallNext[mt.CallToolRequestParams, Any],  # type: ignore
    ) -> Any:
        session_id = current_session_id_ctxvar.get()
        if session_id is None:
            return await call_next(context)

        # Detokenize flat/top-level argument strings; enforce dict shape
        args_any = context.message.arguments
        # FastMCP types define arguments as dict[str, Any] | None; use it directly
        args: dict[str, Any] = args_any or {}
        for k, v in list(args.items()):
            if isinstance(v, str):
                args[k] = detokenize_text(v, session_id=session_id)
        context.message.arguments = args

        result = await call_next(context)

        hex_bytes = 32
        return _obfuscate_flat_payload(result, session_id=session_id, hex_bytes=hex_bytes)
