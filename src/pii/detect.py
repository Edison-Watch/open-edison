import re
from collections.abc import Iterator
from dataclasses import dataclass


@dataclass
class Finding:
    start: int
    end: int
    value: str
    category: str


# TODO double check these for validity
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
OPENAI_RE = re.compile(r"sk-[A-Za-z0-9]{20,}")
GITHUB_PAT_RE = re.compile(r"ghp_[A-Za-z0-9]{36}")
AWS_AKID_RE = re.compile(r"AKIA[0-9A-Z]{16}")
GOOGLE_API_KEY_RE = re.compile(r"AIza[0-9A-Za-z\-_]{35}")
SLACK_TOKEN_RE = re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,48}")


PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (EMAIL_RE, "EMAIL_ADDRESS"),
    (OPENAI_RE, "OPENAI_API_KEY"),
    (GITHUB_PAT_RE, "GITHUB_TOKEN"),
    (AWS_AKID_RE, "AWS_ACCESS_KEY_ID"),
    (GOOGLE_API_KEY_RE, "GOOGLE_API_KEY"),
    (SLACK_TOKEN_RE, "SLACK_TOKEN"),
]


def detect(text: str) -> Iterator[Finding]:
    for pattern, category in PATTERNS:
        for m in pattern.finditer(text):
            yield Finding(start=m.start(), end=m.end(), value=m.group(0), category=category)
