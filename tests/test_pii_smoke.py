import pytest
from fastmcp import Client as FastMCPClient

from src.middleware.pii_obfuscation import _obfuscate_flat_payload
from src.pii import presidio_wrap
from src.pii.db import lookup_token_db, store_token_db
from src.pii.tokens import (
    TOKEN_REGEX,
    detokenize_text,
    generate_token,
)
from tests.test_template import BackgroundServerTemplate, integration_test


@pytest.fixture(autouse=True)
def _use_temp_config_dir(tmp_path, monkeypatch):  # noqa: ANN001
    """Ensure tests in this module use a real temp config dir with sessions.db."""
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))


def test_trivial_email_obfuscation_and_detokenize_roundtrip():
    session_id = "test-session"
    hex_bytes = 16

    # Outbound: tool result contains an email at top-level string
    raw = "Contact me at john@example.com please"
    obfuscated = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=hex_bytes)
    assert isinstance(obfuscated, str)
    assert obfuscated != raw
    assert TOKEN_REGEX.search(obfuscated), obfuscated

    # Inbound: replace token back to original
    restored = detokenize_text(obfuscated, session_id=session_id)
    assert restored == raw


def test_multiple_tokens_are_detokenized_in_one_pass():
    session_id = "test-session-2"
    hex_bytes = 16

    raw = "Send to a@b.com and c@d.org now"
    obfuscated = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=hex_bytes)
    assert obfuscated != raw
    # Ensure two tokens present
    ts = list(TOKEN_REGEX.finditer(obfuscated))
    assert len(ts) >= 2

    restored = detokenize_text(obfuscated, session_id=session_id)
    assert restored == raw


def test_detokenize_various_token_types_roundtrip():
    session_id = "session-various-types"

    # Prepare tokens for different categories
    t_email = generate_token(8)
    t_openai = generate_token(8)
    t_github = generate_token(8)
    t_aws = generate_token(8)

    secret_email = "user@example.com"
    secret_openai = "sk-TESTOPENAIKEY000000"
    secret_github = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"
    secret_aws = "AKIAABCDEFGHIJKLMNOP"

    store_token_db(
        token=t_email,
        session_id=session_id,
        value_plaintext=secret_email,
        categories=["EMAIL_ADDRESS"],
        source_kind="test",
        source_name="test_source",
    )
    store_token_db(
        token=t_openai,
        session_id=session_id,
        value_plaintext=secret_openai,
        categories=["OPENAI_API_KEY"],
        source_kind="test",
        source_name="test_source",
    )
    store_token_db(
        token=t_github,
        session_id=session_id,
        value_plaintext=secret_github,
        categories=["GITHUB_TOKEN"],
        source_kind="test",
        source_name="test_source",
    )
    store_token_db(
        token=t_aws,
        session_id=session_id,
        value_plaintext=secret_aws,
        categories=["AWS_ACCESS_KEY_ID"],
        source_kind="test",
        source_name="test_source",
    )

    text_with_tokens = f"Email {t_email}, openai {t_openai}; github {t_github} and aws {t_aws}."
    restored = detokenize_text(text_with_tokens, session_id=session_id)
    assert secret_email in restored
    assert secret_openai in restored
    assert secret_github in restored
    assert secret_aws in restored


def test_obfuscate_dict_text_payload_multiple_emails():
    session_id = "session-dict-text"
    payload = {
        "type": "text",
        "text": "Contact a@b.com, also cc c@d.org and e@f.net",
    }
    obf = _obfuscate_flat_payload(payload, session_id=session_id, hex_bytes=16)
    assert isinstance(obf, dict)
    assert obf.get("type") == "text"
    txt = obf.get("text")
    assert isinstance(txt, str)
    # Expect at least three tokens
    matches = list(TOKEN_REGEX.finditer(txt))
    assert len(matches) >= 3

    # Roundtrip detokenize
    restored = detokenize_text(txt, session_id=session_id)
    assert restored == payload["text"]


def test_db_persistence_for_obfuscated_token(tmp_path, monkeypatch):
    session_id = "db-session-1"
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))

    raw = "Please email john@example.com about this"
    obf = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=16)
    assert isinstance(obf, str)
    m = TOKEN_REGEX.search(obf)
    assert m is not None
    token = m.group(0)

    # DB lookup should retrieve the original secret
    restored_val = lookup_token_db(token, session_id)
    assert restored_val == "john@example.com"
    # End-to-end detokenize should restore the full text
    assert detokenize_text(obf, session_id=session_id) == raw


def test_db_persistence_multiple_categories(tmp_path, monkeypatch):
    session_id = "db-session-2"
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))

    email = "user@example.org"
    openai_key = "sk-THISISATESTOPENAIKEY000000"
    raw = f"Email {email} and use key {openai_key}"

    obf = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=16)
    assert isinstance(obf, str)
    toks = [m.group(0) for m in TOKEN_REGEX.finditer(obf)]
    assert len(toks) >= 2

    vals = {lookup_token_db(tok, session_id) for tok in toks}
    assert email in vals
    assert openai_key in vals


def test_presidio_mock_detects_and_roundtrips(tmp_path, monkeypatch):
    session_id = "presidio-session"
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))

    # Monkeypatch presidio analyzer to produce a single finding
    def fake_analyze(text: str):  # noqa: ANN001
        # Pretend it found the email at the right offsets
        start = text.index("alice@example.com")
        end = start + len("alice@example.com")
        from src.pii.detect import Finding

        return [Finding(start=start, end=end, value="alice@example.com", category="EMAIL_ADDRESS")]

    monkeypatch.setattr(presidio_wrap, "analyze_with_presidio", fake_analyze)

    raw = "please contact alice@example.com"
    obf = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=16)
    assert isinstance(obf, str)
    assert TOKEN_REGEX.search(obf)
    assert detokenize_text(obf, session_id=session_id) == raw


def test_presidio_real_detection_db_roundtrip(tmp_path, monkeypatch):
    session_id = "presidio-real"
    monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))

    # Ensure regex detector yields no findings so Presidio path is exercised
    import src.middleware.pii_obfuscation as middleware

    monkeypatch.setattr(middleware, "detect", lambda text: [])  # noqa: ARG005

    raw = "please email bob@example.com"
    obf = _obfuscate_flat_payload(raw, session_id=session_id, hex_bytes=16)
    assert isinstance(obf, str)
    m = TOKEN_REGEX.search(obf)
    assert m is not None
    token = m.group(0)

    # DB should contain the mapping from token to original value
    assert lookup_token_db(token, session_id) == "bob@example.com"
    # Roundtrip detokenization should restore the text
    assert detokenize_text(obf, session_id=session_id) == raw


class TestPIIIntegrationEcho(BackgroundServerTemplate):
    @pytest.fixture(autouse=True)
    def _override_config_dir(self, monkeypatch: pytest.MonkeyPatch, tmp_path):
        monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(tmp_path))

    @integration_test
    @pytest.mark.asyncio
    async def test_builtin_echo_middleware_obfuscation(self):
        assert self.server_proxy is not None
        mcp_base = f"http://127.0.0.1:{self.server_proxy.port}/mcp/"

        cases = [
            ("EMAIL_ADDRESS", "alice@example.com"),
            ("OPENAI_API_KEY", "sk-TESTOPENAIKEY123456789012"),
            ("GITHUB_TOKEN", "ghp_" + ("A" * 36)),
            ("AWS_ACCESS_KEY_ID", "AKIA" + "ABCDEFGHIJKLMNOP"),
            ("GOOGLE_API_KEY", "AIza" + ("A" * 35)),
            ("SLACK_TOKEN", "xoxb-" + "AbcDef1234567890"),
        ]

        async with FastMCPClient(mcp_base, timeout=10) as client:  # type: ignore[arg-type]
            for category, secret in cases:
                text = f"Category {category}: {secret}"
                result = await client.call_tool("builtin_echo", {"text": text})
                s1 = str(result)
                assert secret not in s1
                assert "|<PRIVATE_DATA_" in s1

                token = (
                    "|<PRIVATE_DATA_" + s1.split("|<PRIVATE_DATA_", 1)[1].split(">|", 1)[0] + ">|"
                )
                result2 = await client.call_tool("builtin_echo", {"text": f"Token: {token}"})
                s2 = str(result2)
                # Outbound must still be obfuscated (policy: never let PII egress)
                assert secret not in s2
                assert "|<PRIVATE_DATA_" in s2
