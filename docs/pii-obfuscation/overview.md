# PII Obfuscation for Tool Calls (Current State)

This document describes the shipped PII protection in Open Edison for MCP tool calls.

## What it does

- Outbound (MCP → OE → client): detects PII/secrets in tool results and replaces them with tokens.
- Inbound (client → OE → MCP): detects tokens in tool arguments and replaces them with the original values before the tool runs.
- Tokens are persisted in `<config_dir>/sessions.db`, enabling later detokenization.

## Scope

- Applies only to tool calls.
- Assumes flat/top-level input and output fields (strings and simple text payloads).
- Does not cover resources or prompts yet.

## Detection

- Two-pass detector on every outbound string:
  1) Curated regexes for common secrets (email, GitHub PAT, Google API key, Slack token, AWS access key ID, OpenAI key, etc.).
  2) Microsoft Presidio pattern recognizers (configured without NLP downloads).

## Token format and storage

- Token format: `|<PRIVATE_DATA_HEX>|`, where HEX is random (length derived from config defaults; 32 bytes → 64 hex chars).
- Stored in SQLite at `<config_dir>/sessions.db`, table `pii_tokens` with columns:
  - token, session_id, value_plaintext, categories, source_kind, source_name, created_at, last_used_at
- Unique per `(token, session_id)`.

## Middleware

- The `PIIObfuscationMiddleware` is installed in the MCP server stack:
  - Inbound: detokenize flat string arguments.
  - Outbound: obfuscate strings and text content in tool results.

## Testing

- Smoke and unit tests: `pytest -k pii_smoke`
- End-to-end echo smoke with background server and temp config dir:
  - `tests/test_pii_smoke.py::TestPIIIntegrationEcho::test_builtin_echo_middleware_obfuscation`
  - First call with a secret → response is obfuscated.
  - Second call with the token → input is detokenized, response remains obfuscated.
- Full CI: `make ci`

## Current limitations

- Tool calls only (no nested traversal, no resources/prompts yet).
- No partial reveals.
