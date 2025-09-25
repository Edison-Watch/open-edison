# Unfort some annoying deprecation warnings from spacy/weasel which are transitive dependencies of presidio_analyzer
# ruff: noqa: E402
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning, module="spacy.cli._util")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="weasel.util.config")

from presidio_analyzer import Pattern, PatternRecognizer  # noqa: E402

from src.pii.detect import Finding


def analyze_with_presidio(text: str) -> list[Finding]:
    # Use only pattern-based recognizers (no NLP engine, cheap and deterministic)

    patterns: list[tuple[str, str, float]] = [
        (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "EMAIL_ADDRESS", 0.6),
    ]
    recognizers: list[PatternRecognizer] = []
    for regex, entity, score in patterns:
        pat = Pattern(name=f"{entity.lower()}_pat", regex=regex, score=score)
        recognizers.append(PatternRecognizer(supported_entity=entity, patterns=[pat]))

    findings: list[Finding] = []
    for rec in recognizers:
        # Let recognizer use its supported entity by passing entities=None
        results = rec.analyze(text=text, entities=None, nlp_artifacts=None)  # type: ignore[arg-type]
        for r in results:
            findings.append(
                Finding(
                    start=int(r.start),
                    end=int(r.end),
                    value=text[int(r.start) : int(r.end)],
                    category=str(r.entity_type),
                )
            )
    return findings
