import re
from secrets import token_bytes

from src.pii.db import lookup_token_db

TOKEN_PREFIX = "|<PRIVATE_DATA_"
TOKEN_SUFFIX = ">|"
HEX_MIN = 16
HEX_MAX = 128

TOKEN_REGEX = re.compile(f"\\|<PRIVATE_DATA_[0-9A-Fa-f]{{{HEX_MIN},{HEX_MAX}}}>\\|")


def _hex(n_bytes: int) -> str:
    return token_bytes(n_bytes).hex()


def generate_token(hex_len_bytes: int) -> str:
    h = _hex(hex_len_bytes)
    return f"{TOKEN_PREFIX}{h}{TOKEN_SUFFIX}"


def detokenize_text(text: str, *, session_id: str) -> str:
    # Collect all tokens first, then build a mapping to avoid repeated lookups
    matches = list(TOKEN_REGEX.finditer(text))
    if not matches:
        return text

    unique_tokens: set[str] = {m.group(0) for m in matches}

    mapping: dict[str, str | None] = {}
    for tok in unique_tokens:
        val = lookup_token_db(tok, session_id)
        mapping[tok] = val

    def _replace(m: re.Match[str]) -> str:
        tok = m.group(0)
        val = mapping.get(tok)
        return val if val is not None else tok

    return TOKEN_REGEX.sub(_replace, text)
